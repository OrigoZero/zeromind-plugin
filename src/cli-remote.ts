import { readFileSync } from "node:fs";
import { McpHttpClient, type ToolOutcome } from "./mcp-client.js";
import { cliBearer, login, logout } from "./cli-oauth.js";
import { conversationId } from "./cli-state.js";
import { remoteUrl } from "./server-spec.js";

export const REMOTE_HELP = `zero — use a Zero world through its hosted connection

zero login [--force] [--scope 'read write publish']
                                        authorize once in your browser
zero logout                              revoke the CLI's OAuth authorization
zero --context <agent> sessions           list engines, worlds and branches
zero --context <agent> connect --session <id>
zero --context <agent> connect --world <world> --branch <branch>
zero --context <agent> disconnect         release this context's engine connection
zero --context <agent> tools              list hosted operations and schemas
zero --context <agent> call <tool> --input '<json>'
zero --context <agent> bash -c '<command>' run in the engine's shell
zero --context <agent> bash -s            read a shell script from host stdin

ZERO_CONTEXT supplies --context. Codex's CODEX_THREAD_ID is used when present.
Use a distinct context per agent; reuse it across calls to keep the engine pin
and shell state. Worlds, files and shell execution live in the selected engine.
zero open <world> --native|--browser opens an editor on this machine.

Existing integration commands:
zeromind link       link an agent account through /link
zeromind status     show the machine's linked identity
zeromind unlink     revoke that link
zeromind install <harness>   configure the hosted connector
zeromind upload <path> --world <world>   transfer local files
zeromind open <world>       open an editor
`;

/** Unwrap the engine result while retaining exact stdout/stderr strings. */
export function shellResult(
  value: unknown,
): { stdout: string; stderr: string; exitCode: number } | undefined {
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        return undefined;
      }
    }
    if (!value || typeof value !== "object") return undefined;
    const row = value as Record<string, unknown>;
    if (
      typeof row.stdout === "string" &&
      typeof row.stderr === "string" &&
      Number.isInteger(row.exitCode)
    ) {
      return { stdout: row.stdout, stderr: row.stderr, exitCode: row.exitCode as number };
    }
    value = row.result ?? row.result_full ?? row.resultFull;
  }
  return undefined;
}

/** Luau long strings retain Unicode and backslashes; the first newline is consumed by Luau. */
export function shellCode(command: string): string {
  let delimiter = "=";
  while (command.includes(`]${delimiter}]`)) delimiter += "=";
  return `return task.await(shell.runAsync([${delimiter}[\n${command}]${delimiter}]))`;
}

function data(outcome: ToolOutcome): unknown {
  if (outcome.structuredContent !== undefined) return outcome.structuredContent;
  try {
    return JSON.parse(outcome.text);
  } catch {
    return outcome.text;
  }
}

export async function runShell(
  client: Pick<McpHttpClient, "callTool">,
  command: string,
  stdout = (s: string) => {
    process.stdout.write(s);
  },
  stderr = (s: string) => {
    process.stderr.write(s);
  },
): Promise<number> {
  // execute preserves the shell API's separate streams and numeric exit code.
  // The attested caller selects the same shell session as the hosted bash tool.
  let answer = await client.callTool("execute", { code: shellCode(command) });
  for (;;) {
    if (answer.isError) throw new Error(answer.text);
    const value = data(answer);
    const result = shellResult(value);
    if (result) {
      stdout(result.stdout);
      stderr(result.stderr);
      return result.exitCode < 0 ? 1 : result.exitCode & 255;
    }
    const row = value as { taskId?: unknown; status?: string } | null;
    if (row && row.taskId !== undefined && row.status === "running") {
      answer = await client.callTool("wait", { taskId: row.taskId, timeout_secs: 20 });
      continue;
    }
    throw new Error(`The engine returned no shell result: ${answer.text}`);
  }
}

function required(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export async function runRemoteCli(argv: string[]): Promise<void> {
  const args = [...argv];
  let context: string | undefined;
  if (args[0] === "--context") {
    context = required(args, 1, "--context");
    args.splice(0, 2);
  }
  const command = args.shift();
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(REMOTE_HELP);
    return;
  }
  if (command === "login") {
    let force = false,
      scope: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--force") force = true;
      else if (args[i] === "--scope") scope = required(args, ++i, "--scope");
      else throw new Error("Usage: zero login [--force] [--scope 'read write publish']");
    }
    await login({ force, scope });
    return;
  }
  if (command === "logout") {
    if (args.length) throw new Error("Usage: zero logout");
    await logout();
    process.stderr.write("CLI authorization revoked.\n");
    return;
  }
  let tool: string | undefined;
  let input: Record<string, unknown> = {};
  let shell: string | undefined;
  switch (command) {
    case "sessions":
      if (args.length) throw new Error("Usage: zero sessions");
      tool = "session.list";
      break;
    case "disconnect":
      if (args.length) throw new Error("Usage: zero disconnect");
      tool = "world.disconnect";
      break;
    case "tools":
      if (args.length) throw new Error("Usage: zero tools");
      break;
    case "connect":
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i].slice(2);
        if (!["--world", "--branch", "--session"].includes(args[i]) || key in input)
          throw new Error(`Unexpected connect argument: ${args[i]}`);
        input[key] = required(args, i + 1, args[i]);
      }
      if (!input.world && !input.session) throw new Error("connect requires --world or --session");
      tool = "session.connect";
      break;
    case "call": {
      tool = required(args, 0, "call");
      if (args.length > 1) {
        if (args[1] !== "--input" || args.length !== 3)
          throw new Error("Usage: zero call <tool> [--input '<json>']");
        const parsed: unknown = JSON.parse(args[2]);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("--input must be a JSON object");
        input = parsed as Record<string, unknown>;
      }
      break;
    }
    case "bash":
      if (args.length === 2 && args[0] === "-c") shell = args[1];
      else if (args.length === 1 && args[0] === "-s") shell = readFileSync(0, "utf8");
      else throw new Error("Usage: zero bash -c '<command>' or zero bash -s");
      break;
    default:
      throw new Error(`Unknown command: ${command}\n${REMOTE_HELP}`);
  }
  const endpoint = remoteUrl();
  const conversation = await conversationId(endpoint, context);
  const client = new McpHttpClient(endpoint, await cliBearer(), "zero-cli", conversation);
  try {
    await client.initialize();
    if (shell !== undefined) {
      process.exitCode = await runShell(client, shell);
      return;
    }
    if (!tool) {
      process.stdout.write(JSON.stringify(await client.listTools(), null, 2) + "\n");
      return;
    }
    const result = await client.callTool(tool, input);
    if (result.isError) throw new Error(result.text);
    if (command !== "call") {
      process.stdout.write(JSON.stringify(data(result), null, 2) + "\n");
      return;
    }
    process.stdout.write(
      JSON.stringify(
        { content: result.content, structuredContent: result.structuredContent },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await client.close();
  }
}
