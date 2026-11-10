import { expect, it } from "vitest";
import { openEngine, nativeLaunchArgs } from "../src/engine-launch.js";

const world = "11111111-1111-1111-1111-111111111111";
const session = {
  session_id: "remote-browser",
  world_guid: world,
  branch: "feature",
  kind: "browser",
  drivable: true,
  claimed_by_another: false,
};
const answer = (value: unknown) => ({
  text: JSON.stringify(value),
  structuredContent: value,
  isError: false,
});

it("launches an offscreen CPU renderer with explicit framebuffer dimensions and intact branch arguments", () => {
  const launch = "zero://launch?world=world&handoff=private";
  expect(
    nativeLaunchArgs(
      { world, headless: true, softwareRendering: true, branch: "feature/test branch" },
      launch,
    ),
  ).toEqual([
    launch,
    "--branch",
    "feature/test branch",
    "--headless",
    "--headless-width",
    "640",
    "--headless-height",
    "360",
    "--software-rendering",
  ]);
  expect(nativeLaunchArgs({ world, headless: true, width: 800, height: 600 }, launch)).toEqual([
    launch,
    "--headless",
    "--headless-width",
    "800",
    "--headless-height",
    "600",
  ]);
  expect(() => nativeLaunchArgs({ world, softwareRendering: true }, launch)).toThrow(
    "requires --headless",
  );
  expect(() => nativeLaunchArgs({ world, browser: true, headless: true }, launch)).toThrow(
    "native engine",
  );
  for (const width of [0, -1, 8193, 1.5, NaN]) {
    expect(() => nativeLaunchArgs({ world, headless: true, width }, launch)).toThrow("dimensions");
  }
});

it("reuses the correct remote branch and verifies readiness without a local engine", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "world.list") return answer({ worlds: [{ guid: world, name: "Project" }] });
      if (name === "session.list")
        return answer({ sessions: [session, { ...session, session_id: "other", branch: "main" }] });
      if (name === "session.connect")
        return answer({ connected: true, session_id: session.session_id, branch: "feature" });
      if (name === "execute") return answer({ result: true });
      throw new Error(`Unexpected operation ${name}`);
    },
  };
  expect((await openEngine(client, { world: "Project", branch: "feature" })).session_id).toBe(
    "remote-browser",
  );
  expect(calls.find((c) => c.name === "session.connect")?.args).toEqual({
    session: "remote-browser",
    world,
    branch: "feature",
  });
  expect(calls.at(-1)?.name).toBe("execute");
});

it("refuses ambiguous engines instead of selecting a branch or claiming another caller's engine", async () => {
  const client = {
    callTool: async (name: string) => {
      if (name === "world.list") return answer({ worlds: [{ guid: world, name: "Project" }] });
      if (name === "session.list")
        return answer({ sessions: [session, { ...session, session_id: "second" }] });
      throw new Error("Nothing should be claimed");
    },
  };
  await expect(openEngine(client, { world })).rejects.toThrow("Several engines");
  await expect(
    openEngine(client, { world, session: session.session_id, native: true }),
  ).rejects.toThrow("engine kind");
});
