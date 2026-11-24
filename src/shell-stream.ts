import type { Readable, Writable } from "node:stream";
import type { ToolOutcome } from "./mcp-client.js";
import { executeAndWait } from "./engine-execution.js";
import type { StdinSnapshot } from "./stdin-prefetch.js";

type Caller = { callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> };
export function luauString(text: string): string {
  let eq = "=";
  while (text.includes(`]${eq}]`)) eq += "=";
  return `[${eq}[\n${text}]${eq}]`;
}
function value(answer: ToolOutcome): unknown {
  if (answer.isError) throw new Error(answer.text);
  let result: unknown = answer.structuredContent ?? JSON.parse(answer.text);
  if (result && typeof result === "object" && "result" in result)
    result = (result as { result: unknown }).result;
  return result;
}
async function writeOutput(stream: Writable, bytes: Buffer): Promise<void> {
  if (!bytes.length) return;
  await new Promise<void>((resolve, reject) =>
    stream.write(bytes, (error) => (error ? reject(error) : resolve())),
  );
}

/** Output the engine collects inside one inline call before the command moves to streaming reads. */
const INLINE_OUTPUT_LIMIT = 512 * 1024;
/** How long one streaming read waits inside the engine for output or exit. */
const READ_WAIT_SECONDS = 1;

/** Run a shell command to completion in the first call when it finishes within `windowMs`. */
export type InlineOptions = {
  /** Time the engine may spend waiting for the command inside the starting call. */
  windowMs: number;
  /** Host stdin as already read; its bytes travel in the starting call. */
  stdin: StdinSnapshot;
};

/** Start the command, give it the host's stdin, and wait for it in the same engine call. */
export function inlineStartCode(command: string, options: InlineOptions): string {
  const { data, ended } = options.stdin;
  const input = data.length
    ? `local bytes, reason = base64.decode(${luauString(data.toString("base64"))}); assert(bytes, reason); wrote = shell.write(handle, bytes, ${ended ? "true" : "false"})`
    : ended
      ? `wrote = shell.write(handle, "", true)`
      : "";
  return [
    `local start = rawget(shell, "start")`,
    `if type(start) ~= "function" then return {legacy=true} end`,
    `local handle = start(${luauString(command)}, false)`,
    `local wrote = true`,
    input,
    `local out: {string} = {}`,
    `local err: {string} = {}`,
    `local size = 0`,
    `local began = time.realtime()`,
    `local exitCode: number? = nil`,
    `while true do`,
    `  local piece = shell.read(handle)`,
    `  if piece.stdoutBase64 ~= "" then table.insert(out, piece.stdoutBase64); size += #piece.stdoutBase64 end`,
    `  if piece.stderrBase64 ~= "" then table.insert(err, piece.stderrBase64); size += #piece.stderrBase64 end`,
    `  if piece.exitCode ~= nil then exitCode = piece.exitCode; break end`,
    `  if size >= ${INLINE_OUTPUT_LIMIT} or time.realtime() - began >= ${options.windowMs / 1000} then break end`,
    `  task.wait(0.01)`,
    `end`,
    `if exitCode ~= nil then shell.close(handle) end`,
    `return {handle=handle, wrote=wrote, stdout=out, stderr=err, exitCode=exitCode}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A read that waits inside the engine for output or exit instead of being polled by the host. */
function readCode(handle: string): string {
  return `local piece = shell.read(${handle}); local began = time.realtime(); while piece.stdoutBase64 == "" and piece.stderrBase64 == "" and piece.exitCode == nil and time.realtime() - began < ${READ_WAIT_SECONDS} do task.wait(0.01); piece = shell.read(${handle}) end; return piece`;
}

type Started = {
  handle?: string;
  legacy?: boolean;
  wrote?: boolean;
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number | null;
};

const pieces = (list: unknown): Buffer =>
  Array.isArray(list)
    ? Buffer.concat(list.map((piece) => Buffer.from(String(piece), "base64")))
    : Buffer.alloc(0);

/**
 * Attach host streams to the caller's shell through ordinary hosted execute calls. With `inline`,
 * the first call also delivers the host's stdin and waits for the command, so a short command
 * costs one call; a command still running then continues through streaming reads.
 */
export async function streamShell(
  client: Caller,
  command: string,
  input: Readable,
  stdout: Writable,
  stderr: Writable,
  interactive = false,
  inline?: InlineOptions,
): Promise<number | undefined> {
  // A signal that arrives before the engine names the handle is delivered once it does.
  let early: number | undefined;
  const earlyInterrupt = () => {
    early ??= 2;
  };
  const earlyTerminate = () => {
    early = 15;
  };
  if (inline) {
    process.on("SIGINT", earlyInterrupt);
    process.on("SIGTERM", earlyTerminate);
  }
  let started: Started;
  try {
    started = value(
      await executeAndWait(
        client,
        inline
          ? inlineStartCode(command, inline)
          : `local start = rawget(shell, "start"); if type(start) == "function" then return {handle=start(${luauString(command)}, ${interactive ? "true" : "false"})} else return {legacy=true} end`,
      ),
    ) as Started;
  } finally {
    process.removeListener("SIGINT", earlyInterrupt);
    process.removeListener("SIGTERM", earlyTerminate);
  }
  if (started.legacy) return undefined;
  if (typeof started.handle !== "string")
    throw new Error("Engine did not return a shell stream handle");
  if (inline && Number.isInteger(started.exitCode)) {
    // The command finished inside the starting call, which also released its handle.
    await writeOutput(stdout, pieces(started.stdout));
    await writeOutput(stderr, pieces(started.stderr));
    input.pause();
    input.destroy();
    return started.exitCode! & 255;
  }
  const handle = luauString(started.handle);
  // Bytes the starting call did not deliver, and whether stdin already ended.
  const unsent = inline && started.wrote === false ? inline.stdin.data : Buffer.alloc(0);
  const eofSent = inline ? started.wrote !== false && inline.stdin.ended : false;
  const inputEnded = inline ? inline.stdin.ended : false;
  if (inline) {
    await writeOutput(stdout, pieces(started.stdout));
    await writeOutput(stderr, pieces(started.stderr));
  }
  const execute = async (code: string) => value(await executeAndWait(client, code));
  let finished = false,
    inputFailure: Error | undefined,
    signal: Promise<unknown> | undefined;
  const interrupt = (number: number) => {
    signal ??= execute(`return shell.interrupt(${handle}, ${number})`)
      .catch((error) => {
        inputFailure = error as Error;
      })
      .finally(() => {
        signal = undefined;
      });
  };
  const interruptCommand = () => interrupt(2);
  const terminateShell = () => interrupt(15);
  process.on("SIGINT", interruptCommand);
  process.on("SIGTERM", terminateShell);
  if (early !== undefined) interrupt(early);
  // A paused input bounds host-side queued bytes while the engine applies backpressure.
  input.pause();
  const send = async (chunk: Buffer, eof: boolean) => {
    const encoded = luauString(chunk.toString("base64"));
    while (!finished) {
      const accepted = await execute(
        `local bytes, err = base64.decode(${encoded}); assert(bytes, err); return shell.write(${handle}, bytes, ${eof ? "true" : "false"})`,
      );
      if (accepted === true) return;
      if (accepted !== false) throw new Error("Engine returned an invalid stdin acknowledgement");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const inputDone = (async () => {
    if (eofSent) return;
    for (let offset = 0; offset < unsent.length && !finished; offset += 32768)
      await send(unsent.subarray(offset, offset + 32768), false);
    if (input.readableEnded || inputEnded) {
      await send(Buffer.alloc(0), true);
      return;
    }
    for await (const incoming of input) {
      if (finished) break;
      const chunk = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming as string);
      for (let offset = 0; offset < chunk.length && !finished; offset += 32768)
        await send(chunk.subarray(offset, offset + 32768), false);
    }
    if (!finished) await send(Buffer.alloc(0), true);
  })().catch((error) => {
    if (!finished) inputFailure = error as Error;
  });
  try {
    for (;;) {
      if (inputFailure) throw inputFailure;
      const answer = (await execute(readCode(handle))) as {
        stdoutBase64?: string;
        stderrBase64?: string;
        exitCode?: number | null;
      };
      if (typeof answer.stdoutBase64 !== "string" || typeof answer.stderrBase64 !== "string")
        throw new Error("Engine returned an invalid shell stream response");
      await writeOutput(stdout, Buffer.from(answer.stdoutBase64, "base64"));
      await writeOutput(stderr, Buffer.from(answer.stderrBase64, "base64"));
      if (Number.isInteger(answer.exitCode)) return answer.exitCode! & 255;
      // The engine already waited for output; this only yields to the host's own I/O.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    finished = true;
    input.pause();
    // Remove the iterator's pending read so a terminal awaiting a line does not retain this invocation.
    input.destroy();
    await inputDone;
    await signal;
    process.removeListener("SIGINT", interruptCommand);
    process.removeListener("SIGTERM", terminateShell);
    await execute(`shell.close(${handle}); return true`);
  }
}
