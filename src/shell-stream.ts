import type { Readable, Writable } from "node:stream";
import type { ToolOutcome } from "./mcp-client.js";
import { executeAndWait } from "./engine-execution.js";

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

/** Attach host streams to the caller's shell through ordinary hosted execute calls. */
export async function streamShell(
  client: Caller,
  command: string,
  input: Readable,
  stdout: Writable,
  stderr: Writable,
  interactive = false,
): Promise<number | undefined> {
  const started = value(
    await executeAndWait(
      client,
      `local start = rawget(shell, "start"); if type(start) == "function" then return {handle=start(${luauString(command)}, ${interactive ? "true" : "false"})} else return {legacy=true} end`,
    ),
  ) as { handle?: string; legacy?: boolean };
  if (started.legacy) return undefined;
  if (typeof started.handle !== "string")
    throw new Error("Engine did not return a shell stream handle");
  const handle = luauString(started.handle);
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
    if (input.readableEnded) {
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
      const answer = (await execute(`return shell.read(${handle})`)) as {
        stdoutBase64?: string;
        stderrBase64?: string;
        exitCode?: number | null;
      };
      if (typeof answer.stdoutBase64 !== "string" || typeof answer.stderrBase64 !== "string")
        throw new Error("Engine returned an invalid shell stream response");
      await writeOutput(stdout, Buffer.from(answer.stdoutBase64, "base64"));
      await writeOutput(stderr, Buffer.from(answer.stderrBase64, "base64"));
      if (Number.isInteger(answer.exitCode)) return answer.exitCode! & 255;
      await new Promise((resolve) => setTimeout(resolve, 50));
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
