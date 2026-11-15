import { readFileSync } from "node:fs";
import { McpHttpClient, type ToolOutcome } from "./mcp-client.js";
import { cliBearer, loginAgent, logoutAgent } from "./cli-agent.js";
import { conversationId } from "./cli-state.js";
import { remoteUrl } from "./server-spec.js";
import { openEngine, type OpenOptions } from "./engine-launch.js";
import { closeEngine, runningEngines } from "./engine-registry.js";
import { streamShell } from "./shell-stream.js";
import { interactiveShell } from "./shell-interactive.js";
import { shellInvocation } from "./shell-invocation.js";
import { executeAndWait } from "./engine-execution.js";
import { parseWorldReference, runOpenCli } from "./cli-open.js";

export const REMOTE_HELP = `zero — use a Zero world through its hosted connection

zero login [--username <agent>] [--no-browser]
                                        approve an agent identity once in your browser
zero logout                              revoke this CLI agent's authorization
zero whoami                              show the authorized account and scopes
zero --context <agent> sessions           list engines, worlds and branches
zero --context <agent> connect --session <id>
zero --context <agent> connect --world <world> --branch <branch>
zero --context <agent> disconnect         release this context's engine connection
zero --context <agent> open <world> [--branch <branch>] [--native|--browser]
                                        connect or install, launch and await an engine
  --headless [--software-rendering]       start an offscreen native engine, optionally on CPU
  --width <pixels> --height <pixels>      headless framebuffer size
  --idle-minutes <minutes>               stop a headless engine after this long with no call (default 90, 0 never)
zero engines                             list the native engines this CLI launched that still run
zero --context <agent> close              stop the engines this context launched, with their sub-clients
  --session <id> | --all                 stop the engine on that session, or every engine listed
zero engine install [--version <version>] install a verified native release
  --software-rendering                   verify CPU rendering; provision Debian/Ubuntu drivers if needed
zero engine status                       show the CLI-managed native installation
zero engine doctor [--software-rendering] test the installed offscreen renderer without login
zero --context <agent> tools              list hosted operations and schemas
zero --context <agent> call <tool> --input '<json>'
zero --context <agent> bash -c '<command>' run in the engine's shell
zero --context <agent> bash -s            read a shell script from host stdin
zero --context <agent> bash -i            interactive shell with local line editing
zero bash-env                            print a Bash startup file that routes commands to Zero

ZERO_CONTEXT supplies --context. Codex's CODEX_THREAD_ID is used when present.
Use a distinct context per agent; reuse it across calls to keep the engine pin
and shell state. Worlds, files and shell execution live in the selected engine.
zero open uses the same managed launch with ZERO_CONTEXT or CODEX_THREAD_ID.
zero open <world> --play opens the player; --dry-run previews an open URL.

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
  const answer = await executeAndWait(client, shellCode(command));
  const result = shellResult(data(answer));
  if (result) {
    stdout(result.stdout);
    stderr(result.stderr);
    return result.exitCode < 0 ? 1 : result.exitCode & 255;
  }
  throw new Error(`The engine returned no shell result: ${answer.text}`);
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
    let username: string | undefined;
    let noBrowser = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--no-browser") noBrowser = true;
      else if (args[i] === "--username") username = required(args, ++i, "--username");
      else throw new Error("Usage: zero login [--username <agent>] [--no-browser]");
    }
    await loginAgent({ username, noBrowser });
    return;
  }
  if (command === "engines") {
    if (args.length) throw new Error("Usage: zero engines");
    process.stdout.write(JSON.stringify({ engines: await runningEngines() }, null, 2) + "\n");
    return;
  }
  if (command === "close") {
    let session: string | undefined;
    let all = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--all") all = true;
      else if (args[i] === "--session") session = required(args, ++i, "--session");
      else throw new Error("Usage: zero [--context <agent>] close [--session <id> | --all]");
    }
    if (all && session) throw new Error("Choose --session <id> or --all");
    const engines = await runningEngines();
    const conversation =
      all || session ? undefined : await conversationId(remoteUrl(), context);
    const chosen = engines.filter((e) =>
      all ? true : session ? e.sessionId === session : e.conversation === conversation,
    );
    if (!chosen.length)
      throw new Error(
        engines.length
          ? "No running engine matches; zero engines lists the ones this CLI launched."
          : "No engine this CLI launched is running.",
      );
    for (const engine of chosen) await closeEngine(engine);
    process.stdout.write(
      JSON.stringify(
        { closed: chosen.map((e) => ({ pid: e.pid, world: e.world, session: e.sessionId })) },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  if (command === "logout") {
    if (args.length) throw new Error("Usage: zero logout");
    await logoutAgent();
    process.stderr.write("CLI authorization revoked.\n");
    return;
  }
  let tool: string | undefined;
  let input: Record<string, unknown> = {};
  let shell: string | undefined;
  let interactive = false;
  let open: OpenOptions | undefined;
  switch (command) {
    case "whoami":
      if (args.length) throw new Error("Usage: zero whoami");
      tool = "zeromind.profile";
      break;
    case "open": {
      if (args.includes("--help") || args.includes("-h")) {
        process.stdout.write(REMOTE_HELP);
        return;
      }
      if (args.includes("--play") || args.includes("--dry-run")) {
        await runOpenCli(args);
        return;
      }
      open = { world: "" };
      for (let i = 0; i < args.length; i++) {
        const argument = args[i];
        if (
          [
            "--world",
            "--branch",
            "--session",
            "--bin",
            "--width",
            "--height",
            "--idle-minutes",
          ].includes(argument)
        ) {
          const value = required(args, ++i, argument);
          if (argument === "--world") open.world = value;
          if (argument === "--branch") open.branch = value;
          if (argument === "--session") open.session = value;
          if (argument === "--bin") open.bin = value;
          if (argument === "--width") open.width = Number(value);
          if (argument === "--height") open.height = Number(value);
          if (argument === "--idle-minutes") {
            const minutes = Number(value);
            if (!Number.isInteger(minutes) || minutes < 0)
              throw new Error("--idle-minutes takes a whole number of minutes, 0 for never");
            open.idleMinutes = minutes;
          }
        } else if (argument === "--native") open.native = true;
        else if (argument === "--edit") {
          /* Editor mode is the managed launch default. */
        } else if (argument === "--headless") open.headless = true;
        else if (argument === "--software-rendering") open.softwareRendering = true;
        else if (argument === "--browser") open.browser = true;
        else if (argument === "--new") open.newSession = true;
        else if (!argument.startsWith("-") && !open.world) open.world = argument;
        else throw new Error(`Unexpected open argument: ${argument}`);
      }
      if (!open.world) throw new Error("open requires a world name or guid");
      const reference = parseWorldReference(open.world);
      if (reference.mode === "play" && !args.includes("--edit")) {
        await runOpenCli(args);
        return;
      }
      open.world = reference.guid ?? reference.name!;
      break;
    }
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
        const parsed: unknown = JSON.parse(args[2] === "-" ? readFileSync(0, "utf8") : args[2]);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("--input must be a JSON object");
        input = parsed as Record<string, unknown>;
      }
      break;
    }
    case "bash":
      if ((args.length === 1 && args[0] === "-i") || (args.length === 0 && process.stdin.isTTY))
        interactive = true;
      else shell = shellInvocation(args, () => readFileSync(0, "utf8"));
      break;
    default:
      throw new Error(`Unknown command: ${command}\n${REMOTE_HELP}`);
  }
  const endpoint = remoteUrl();
  const conversation = await conversationId(
    endpoint,
    context ?? (command === "whoami" ? "identity" : undefined),
  );
  const client = new McpHttpClient(endpoint, await cliBearer(), "zero-cli", conversation);
  try {
    await client.initialize();
    if (interactive) {
      process.exitCode = await interactiveShell(
        client,
        process.stdin,
        process.stdout,
        process.stderr,
      );
      return;
    }
    if (open) {
      process.stdout.write(
        JSON.stringify(await openEngine(client, { ...open, conversation }), null, 2) + "\n",
      );
      return;
    }
    if (shell !== undefined) {
      const streamed = await streamShell(
        client,
        shell,
        process.stdin,
        process.stdout,
        process.stderr,
      );
      if (streamed === undefined) {
        if (!process.stdin.isTTY) {
          for await (const chunk of process.stdin) {
            if (chunk.length)
              throw new Error(
                "This engine needs an update for command stdin; use zero engine install and open a new native engine.",
              );
          }
        }
        process.exitCode = await runShell(client, shell);
      } else process.exitCode = streamed;
      return;
    }
    if (!tool) {
      process.stdout.write(JSON.stringify(await client.listTools(), null, 2) + "\n");
      return;
    }
    const result = await client.callTool(tool, input);
    if (result.isError) throw new Error(result.text);
    if (command === "whoami") {
      const profile = data(result) as {
        user?: { id?: string; username?: string; is_agent?: boolean };
        scopes?: string[];
      };
      process.stdout.write(
        JSON.stringify(
          {
            id: profile.user?.id,
            username: profile.user?.username,
            is_agent: profile.user?.is_agent,
            scopes: profile.scopes,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }
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
