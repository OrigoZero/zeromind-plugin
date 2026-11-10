import { afterEach, beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (...args: unknown[]) => execute(...args),
}));

import { checkHeadlessRenderer, openEngine } from "../src/engine-launch.js";
import { runEngineCli } from "../src/engine-install.js";

const cpuReport = {
  headless: true,
  kind: "cpu",
  adapter: "Software adapter",
  driver: "CPU driver",
  width: 640,
  height: 360,
};

beforeEach(() => {
  execute.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it("keeps a parent desktop application's AppImage location out of engine probes", async () => {
  vi.stubEnv("APPIMAGE", "/parent/application.AppImage");
  vi.stubEnv("APPDIR", "/parent/mounted");
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(null, { stdout: JSON.stringify(cpuReport) }),
  );
  await checkHeadlessRenderer("engine", { world: "", headless: true, softwareRendering: true });
  expect(execute.mock.calls[0][2].env.APPIMAGE).toBeUndefined();
  expect(execute.mock.calls[0][2].env.APPDIR).toBeUndefined();
  expect(process.env.APPIMAGE).toBe("/parent/application.AppImage");
});

it("runs the renderer doctor repeatedly without an account or world", async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(null, { stdout: JSON.stringify(cpuReport) }),
  );
  let printed = "";
  const output = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    printed += String(chunk);
    return true;
  });
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      printed = "";
      await runEngineCli(["doctor", "--software-rendering", "--bin", process.execPath]);
      expect(JSON.parse(printed)).toEqual({ binary: process.execPath, renderer: cpuReport });
    }
  } finally {
    output.mockRestore();
  }
});

it("checks an actual CPU adapter without passing a world or credential", async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(null, { stdout: `startup\n${JSON.stringify(cpuReport)}\n` }),
  );
  await checkHeadlessRenderer("engine", {
    world: "private-world",
    branch: "feature",
    headless: true,
    softwareRendering: true,
  });
  expect(execute.mock.calls[0][1]).toEqual([
    "--headless",
    "--headless-width",
    "640",
    "--headless-height",
    "360",
    "--software-rendering",
    "--check-renderer",
  ]);
});

it("rejects hardware substitution and invalid diagnostic output", async () => {
  for (const stdout of [
    JSON.stringify({ ...cpuReport, kind: "discrete" }),
    JSON.stringify({ ...cpuReport, width: 1920 }),
    "old engine",
    "null",
  ]) {
    execute.mockImplementation((_file, _args, _options, callback) => callback(null, { stdout }));
    await expect(
      checkHeadlessRenderer("engine", {
        world: "world",
        headless: true,
        softwareRendering: true,
      }),
    ).rejects.toThrow();
  }
});

it("fails before disconnect or credential issuance when the installed engine cannot render", async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(Object.assign(new Error("unsupported flag"), { stderr: "unknown --check-renderer" })),
  );
  const calls: string[] = [];
  const client = {
    callTool: async (name: string) => {
      calls.push(name);
      const value =
        name === "world.list" ? { worlds: [{ guid: "world", name: "Project" }] } : { sessions: [] };
      return { text: JSON.stringify(value), structuredContent: value, isError: false };
    },
  };
  await expect(
    openEngine(client, {
      world: "Project",
      bin: process.execPath,
      headless: true,
    }),
  ).rejects.toThrow("unknown --check-renderer");
  expect(calls).toEqual(["world.list", "session.list"]);
});
