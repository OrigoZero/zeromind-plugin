// Tells the engine which agent of this Claude Code session made each call.
//
// The subagents a session runs share its connection to ZeroMind, so the
// engine tells them apart by the name each call carries as `as`. Claude Code
// hands this PreToolUse hook the subagent a call came from (`agent_id`, absent
// for the main agent), and the hook writes it over whatever the model put
// there: a subagent's id, and no name for the main agent. A builder that
// named its own call "reviewer" recorded a review of its own work as another
// agent's. The hook decides nothing about whether the call may run.

import { pathToFileURL } from "node:url";

// The name the agent goes by on the engine's roster: lowercase letters,
// digits, '-' and '_', at most 32 characters.
function agentName(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
}

export function stamp(input) {
  const { as: _stated, ...call } = input.tool_input ?? {};
  const agent = typeof input.agent_id === "string" && input.agent_id !== "" ? input.agent_id : null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: agent === null ? call : { ...call, as: agentName(agent) },
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => {
    process.stdout.write(JSON.stringify(stamp(JSON.parse(text))));
  });
}
