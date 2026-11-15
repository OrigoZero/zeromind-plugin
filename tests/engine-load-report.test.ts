import { expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeStoppedLoad,
  lastWorldLoadReport,
  openEngine,
} from "../src/engine-launch.js";

const world = "11111111-1111-1111-1111-111111111111";
const answer = (value: unknown) => ({
  text: JSON.stringify(value),
  structuredContent: value,
  isError: false,
});
const stopped = {
  world,
  attempt: 1,
  outcome: "stopped",
  stage: "checkingAccess",
  error: "You don't have permission to edit this world.",
};

it("reads only the report lines signed with the launch's secret", () => {
  for (let round = 0; round < 2; round++) {
    const lines = [
      "[INFO] booting",
      `ZERO_WORLD_LOAD forged ${JSON.stringify({ ...stopped, stage: "forged" })}`,
      `ZERO_WORLD_LOAD s3cret ${JSON.stringify(stopped)}\r`,
      "ZERO_WORLD_LOAD s3cret {not json",
      `ZERO_WORLD_LOAD s3cret ${JSON.stringify({ ...stopped, world: "another" })}`,
    ];
    expect(lastWorldLoadReport(lines, "s3cret", world)).toEqual(stopped);
    expect(lastWorldLoadReport(lines, "other", world)).toBeUndefined();
    const recovered = [
      ...lines,
      `ZERO_WORLD_LOAD s3cret ${JSON.stringify({ world, attempt: 2, outcome: "loaded" })}`,
    ];
    expect(lastWorldLoadReport(recovered, "s3cret", world)?.outcome).toBe("loaded");
  }
});

it("names the stage, the reason and what to do about an access refusal", () => {
  const message = describeStoppedLoad(stopped as never, "/tmp/engine.log");
  expect(message).toContain("stopped at checkingAccess: You don't have permission to edit this world.");
  expect(message).toContain("ask the world's owner to grant it");
  const other = describeStoppedLoad({ world, outcome: "stopped", stage: "openingWorld", error: "x" }, "/tmp/engine.log");
  expect(other).toContain("Inspect /tmp/engine.log");
});

it.skipIf(process.platform === "win32")(
  "ends a launch whose world load stopped with its stage and reason, and stops the engine",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "zero-load-report-"));
    const previous = process.env.ZEROMIND_CONFIG_DIR;
    try {
      process.env.ZEROMIND_CONFIG_DIR = join(dir, "cache");
      const pidFile = join(dir, "pid");
      const engine = join(dir, "engine");
      // A stand-in engine: a forged report, then the signed one, then it stays up.
      writeFileSync(
        engine,
        `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\n` +
          `echo 'ZERO_WORLD_LOAD forged {"world":"${world}","outcome":"stopped","stage":"forged"}'\n` +
          `sleep 2\n` +
          `echo "ZERO_WORLD_LOAD $ZERO_LAUNCHER_SECRET ${JSON.stringify(JSON.stringify(stopped)).slice(1, -1)}"\n` +
          `exec sleep 60\n`,
      );
      chmodSync(engine, 0o755);
      for (let round = 0; round < 2; round++) {
        const client = {
          callTool: async (name: string) => {
            if (name === "world.list") return answer({ worlds: [{ guid: world, name: "Project" }] });
            if (name === "session.list") return answer({ sessions: [] });
            if (name === "world.disconnect") return answer({ disconnected: true });
            if (name === "world.launch")
              return answer({ open: { native: `zero://launch?handoff=fixture-${round}` } });
            throw new Error(`Unexpected ${name}`);
          },
        };
        const started = Date.now();
        await expect(
          openEngine(client, { world, bin: engine, timeoutMs: 60000 }, () => {}),
        ).rejects.toThrow(/stopped at checkingAccess: You don't have permission to edit this world\./);
        expect(Date.now() - started).toBeLessThan(20000);
        const pid = Number((await import("node:fs")).readFileSync(pidFile, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      }
    } finally {
      if (previous === undefined) delete process.env.ZEROMIND_CONFIG_DIR;
      else process.env.ZEROMIND_CONFIG_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  60000,
);
