// Watchdog timeout for MCP tool calls.
//
// Every tool dispatched by the server is raced against a deadline so a single
// hung op — a bridge RPC whose `rpc.response` never arrives, an `undici`
// fetch with no socket timeout — can never wedge the MCP request handler
// forever. The cap is the LAST line of defence: tools with their own,
// shorter internal timeout (e.g. world.connect's `timeout_ms`) resolve their
// own way first; this only fires when nothing else does.
//
// Tune with ZEROMIND_TOOL_TIMEOUT_MS (milliseconds). The default is generous
// so genuinely slow engine ops (luau_test, a heavy capture) finish normally.

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/** Headroom added on top of a tool's own internal timeout (e.g. world.connect)
 *  so the watchdog never pre-empts the tool's own graceful timeout path. */
export const TOOL_TIMEOUT_BUFFER_MS = 15_000;

export class ToolTimeoutError extends Error {
  readonly code = "timeout";
  constructor(
    public readonly tool: string,
    public readonly timeout_ms: number,
  ) {
    super(
      `tool '${tool}' timed out after ${timeout_ms}ms. The engine/backend did not ` +
        `respond in time — retry, or raise ZEROMIND_TOOL_TIMEOUT_MS if this op is ` +
        `legitimately slow.`,
    );
    this.name = "ToolTimeoutError";
  }
}

/** The configured maximum, read fresh each call so it can be changed without a
 *  restart. Falls back to the default for unset / non-positive / non-numeric. */
export const toolTimeoutMs = (): number => {
  const raw = process.env.ZEROMIND_TOOL_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_TOOL_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TOOL_TIMEOUT_MS;
};

/** Race `op` against a deadline. Rejects with {@link ToolTimeoutError} if `ms`
 *  elapses first. The watchdog timer is always cleared (and never keeps the
 *  process alive), whether `op` settles first or the deadline wins. */
export const withTimeout = async <T>(
  op: Promise<T>,
  ms: number,
  tool: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(tool, ms)), ms);
    // A pending watchdog must not, by itself, hold the event loop open.
    timer.unref?.();
  });
  try {
    return await Promise.race([op, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
