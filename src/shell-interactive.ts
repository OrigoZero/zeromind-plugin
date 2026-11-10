import { createInterface } from "node:readline";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { streamShell } from "./shell-stream.js";

/** Supply local line editing and history while the engine owns shell parsing and execution. */
export async function interactiveShell(
  client: Parameters<typeof streamShell>[0],
  input: Readable & { isTTY?: boolean },
  stdout: Writable & { isTTY?: boolean },
  stderr: Writable,
): Promise<number> {
  const incoming = new PassThrough({ highWaterMark: 32768 });
  const terminal = createInterface({
    input,
    output: stdout,
    terminal: Boolean(input.isTTY && stdout.isTTY),
    historySize: 1000,
  });
  terminal.on("line", (line) => {
    if (!incoming.write(line + "\n")) terminal.pause();
  });
  incoming.on("drain", () => terminal.resume());
  terminal.on("close", () => incoming.end());
  terminal.on("SIGINT", () => {
    terminal.write(null, { ctrl: true, name: "u" });
    process.emit("SIGINT");
  });
  try {
    const result = await streamShell(client, "", incoming, stdout, stderr, true);
    if (result === undefined)
      throw new Error("This engine needs an update for interactive shell sessions.");
    return result;
  } finally {
    terminal.close();
    input.pause();
    incoming.destroy();
  }
}
