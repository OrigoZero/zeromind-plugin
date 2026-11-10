import { expect, it } from "vitest";
import { executeAndWait } from "../src/engine-execution.js";

it("follows kickoff and repeated task waits while dispatching the command once", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const answers = [
    { text: JSON.stringify({ status: "running", kickoffId: "accepted-1" }) },
    { text: "", structuredContent: { status: "running", taskId: 0 } },
    { text: JSON.stringify({ status: "running", taskId: 0 }) },
    { text: JSON.stringify({ result: { handle: "shell-1" } }) },
  ];
  const result = await executeAndWait(
    {
      callTool: async (name, args) => {
        calls.push([name, args]);
        return answers.shift()!;
      },
    },
    "return shell.start('command')",
  );
  expect(JSON.parse(result.text)).toEqual({ result: { handle: "shell-1" } });
  expect(calls).toEqual([
    ["execute", { code: "return shell.start('command')" }],
    ["wait", { kickoffId: "accepted-1", timeout_secs: 20 }],
    ["wait", { taskId: 0, timeout_secs: 20 }],
    ["wait", { taskId: 0, timeout_secs: 20 }],
  ]);
});

it("preserves a script's own pending-shaped result", async () => {
  const answer = { text: JSON.stringify({ result: { status: "running", taskId: "user-data" } }) };
  expect(await executeAndWait({ callTool: async () => answer }, "return data")).toBe(answer);
});

it("reports remote failures and malformed pending responses", async () => {
  await expect(
    executeAndWait(
      { callTool: async () => ({ isError: true, text: "engine unavailable" }) },
      "return true",
    ),
  ).rejects.toThrow("engine unavailable");
  await expect(
    executeAndWait({ callTool: async () => ({ text: '{"status":"running"}' }) }, "return true"),
  ).rejects.toThrow("without a task or kickoff handle");
});
