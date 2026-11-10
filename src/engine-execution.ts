import type { ToolOutcome } from "./mcp-client.js";

type Caller = { callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> };

/** Dispatch once and follow the engine's queued or running execution handles. */
export async function executeAndWait(client: Caller, code: string): Promise<ToolOutcome> {
  let answer = await client.callTool("execute", { code });
  for (;;) {
    if (answer.isError) throw new Error(answer.text);
    let value = answer.structuredContent;
    if (value === undefined) {
      try {
        value = JSON.parse(answer.text);
      } catch {
        return answer;
      }
    }
    if (!value || typeof value !== "object") return answer;
    const pending = value as { status?: string; taskId?: unknown; kickoffId?: unknown };
    if (pending.status !== "running") return answer;
    const handle =
      pending.taskId !== undefined
        ? { taskId: pending.taskId }
        : pending.kickoffId !== undefined
          ? { kickoffId: pending.kickoffId }
          : undefined;
    if (!handle)
      throw new Error("The engine reported pending execution without a task or kickoff handle");
    answer = await client.callTool("wait", { ...handle, timeout_secs: 20 });
  }
}
