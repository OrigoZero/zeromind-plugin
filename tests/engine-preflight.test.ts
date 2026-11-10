import { beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (...args: unknown[]) => execute(...args),
}));

import { checkHeadlessRenderer, openEngine } from "../src/engine-launch.js";

beforeEach(() => {
  execute.mockReset();
});

it("checks an actual CPU adapter without passing a world or credential", async () => {
  execute.mockImplementation((_file, _args, _options, callback) =>
    callback(null, { stdout: 'startup\n{"headless":true,"kind":"cpu"}\n' }),
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
  for (const stdout of ['{"headless":true,"kind":"discrete"}', "old engine"]) {
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
