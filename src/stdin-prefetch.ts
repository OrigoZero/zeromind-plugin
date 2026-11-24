import type { Readable } from "node:stream";

/** What the host's stdin already delivered: the bytes read so far and whether the stream ended. */
export type StdinSnapshot = { data: Buffer; ended: boolean };

export type StdinWatch = {
  /** Stop watching and return what arrived; bytes read after this belong to the stream again. */
  snapshot(): StdinSnapshot;
};

/** The most bytes read ahead; the rest stays in the stream. */
export const PREFETCH_LIMIT = 128 * 1024;

/**
 * Read host stdin while the CLI is still making its first requests, so a command with piped
 * input or an already-ended stdin can start, receive its input and finish in a single call.
 * Nothing is lost when stdin has more to say: unread bytes stay in the stream.
 */
export function watchStdin(input: Readable, limit = PREFETCH_LIMIT): StdinWatch {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let ended = input.readableEnded;
  let watching = !ended;
  const pull = () => {
    while (bytes < limit) {
      const chunk = input.read() as Buffer | string | null;
      if (chunk === null) return;
      let piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes + piece.length > limit) {
        // Past the limit: keep the rest in the stream for whoever reads it next.
        input.unshift(piece.subarray(limit - bytes));
        piece = piece.subarray(0, limit - bytes);
      }
      chunks.push(piece);
      bytes += piece.length;
    }
  };
  const onEnd = () => {
    ended = true;
  };
  const noop = () => undefined;
  if (watching) {
    input.on("readable", pull);
    input.once("end", onEnd);
    // A stream that fails is reported where it is read; the watcher only stops listening.
    input.on("error", noop);
  }
  return {
    snapshot() {
      if (watching) {
        watching = false;
        pull();
        input.removeListener("readable", pull);
        input.removeListener("end", onEnd);
        input.removeListener("error", noop);
        // A stream that ended while the last bytes were read is ended even before 'end' is emitted.
        if (input.readableEnded) ended = true;
      }
      return { data: Buffer.concat(chunks), ended };
    },
  };
}
