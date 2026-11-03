import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-ignore: a plain ES module the hook runs as it is
import { stamp } from "../hooks/stamp.mjs";

const HOOK = fileURLToPath(new URL("../hooks/stamp.mjs", import.meta.url));

// The subagents of one Claude Code session share its connection to ZeroMind, so
// what tells them apart is the name each engine call carries as `as`. Claude
// Code hands this hook the subagent a call came from (`agent_id`, none for the
// main agent); the hook writes it over whatever the model put there, so a
// builder cannot record a review of its own work under a reviewer's name.
describe("the subagent stamp", () => {
  it("a subagent call carries its agent id", () => {
    const out = stamp({ agent_id: "ad65415753d644d35", tool_input: { code: "return 1", as: "reviewer" } });
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.updatedInput).toEqual({ code: "return 1", as: "ad65415753d644d35" });
  });

  it("the main agent's call carries no name it wrote", () => {
    const out = stamp({ agent_id: null, tool_input: { code: "return 1", as: "reviewer" } });
    expect(out.hookSpecificOutput.updatedInput).toEqual({ code: "return 1" });
  });

  it("an id outside the name alphabet becomes a valid name", () => {
    const out = stamp({ agent_id: "Agent/ID.With:Chars", tool_input: {} });
    expect(out.hookSpecificOutput.updatedInput.as).toBe("agent-id-with-chars");
  });

  it("decides nothing about whether the call may run", () => {
    const out = stamp({ agent_id: "a1", tool_input: {} });
    expect(out.hookSpecificOutput).not.toHaveProperty("permissionDecision");
  });

  it("answers Claude Code on stdout for the input on stdin", () => {
    const run = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", agent_id: "a2", tool_input: { text: "x" } }),
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).hookSpecificOutput.updatedInput).toEqual({ text: "x", as: "a2" });
  });
});
