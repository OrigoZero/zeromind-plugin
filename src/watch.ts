// Generic watch primitive (the "node package" piece — host-agnostic).
//
// The agent registers a watcher on a condition (a Luau expression's return
// value, a VFS file appearing, etc.) and ENDS ITS TURN. A polling timer in
// this process — NOT in the OrigoZero server, NOT in the engine — re-evaluates
// the condition on an interval. When the matcher fires, an emit callback runs
// (the per-plugin wiring turns that into a host-native re-entry event). On
// timeout, the same emit callback runs with a timeout payload.
//
// Critical: watch is non-blocking. `register()` returns immediately with a
// watcher_id. The fire is delivered out-of-band via the emit callback in a
// later turn. This is what makes `unregister()` from a later turn actually
// useful — the agent is alive and out of any tool call, free to cancel.

import { randomBytes } from "node:crypto";

export type Matcher =
  | { equals: unknown }
  | { non_nil: true }
  | { gte: number }
  | { exists: true };

export type WatchSource =
  | { expr: string }
  | { vfs_path: string }
  | { status_field: string };

export type WatchArgs = {
  expr?: string;
  vfs_path?: string;
  status_field?: string;
  matcher: Matcher;
  poll_ms?: number;
  timeout_ms?: number;
  label?: string;
};

export type WatchFireEvent = {
  type: "watcher.fired";
  watcher_id: string;
  label?: string;
  value: unknown;
  source: WatchSource;
  matched_at: number;
};

export type WatchTimeoutEvent = {
  type: "watcher.timeout";
  watcher_id: string;
  label?: string;
  source: WatchSource;
  timeout_ms: number;
  fired_at: number;
};

export type WatchEvent = WatchFireEvent | WatchTimeoutEvent;

export type PollExecutor = (source: WatchSource) => Promise<unknown>;

export const DEFAULT_POLL_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 600_000;
export const MIN_POLL_MS = 250;

const MATCHER_KEYS = ["equals", "non_nil", "gte", "exists"] as const;
const SOURCE_KEYS = ["expr", "vfs_path", "status_field"] as const;

export const evaluateMatcher = (matcher: Matcher, value: unknown): boolean => {
  if ("equals" in matcher) {
    // Deep equality via canonical JSON so the agent can express `{ equals:
    // "finished" }` and have it match the engine returning the string
    // "finished". `undefined` is never equal to anything (mirrors JS).
    if (value === undefined) return matcher.equals === undefined;
    try {
      return JSON.stringify(value) === JSON.stringify(matcher.equals);
    } catch {
      return false;
    }
  }
  if ("non_nil" in matcher) return value !== null && value !== undefined;
  if ("gte" in matcher) {
    return typeof value === "number" && Number.isFinite(value) && value >= matcher.gte;
  }
  if ("exists" in matcher) return value !== undefined;
  return false;
};

export const validateMatcher = (m: unknown): Matcher => {
  if (!m || typeof m !== "object") {
    throw new Error(
      "matcher must be an object with exactly one of: equals, non_nil, gte, exists",
    );
  }
  const present = MATCHER_KEYS.filter((k) => k in (m as Record<string, unknown>));
  if (present.length === 0) {
    throw new Error("matcher must have one of: equals, non_nil, gte, exists");
  }
  if (present.length > 1) {
    throw new Error(
      `matcher must have exactly one of: equals, non_nil, gte, exists (got: ${present.join(", ")})`,
    );
  }
  return m as Matcher;
};

export const validateSource = (a: Record<string, unknown>): WatchSource => {
  const present = SOURCE_KEYS.filter(
    (k) => k in a && a[k] != null && a[k] !== "",
  );
  if (present.length === 0) {
    throw new Error("must specify exactly one of: expr, vfs_path, status_field");
  }
  if (present.length > 1) {
    throw new Error(
      `must specify exactly one of: expr, vfs_path, status_field (got: ${present.join(", ")})`,
    );
  }
  const k = present[0];
  if (k === "expr") return { expr: String(a.expr) };
  if (k === "vfs_path") return { vfs_path: String(a.vfs_path) };
  return { status_field: String(a.status_field) };
};

type Entry = {
  id: string;
  source: WatchSource;
  matcher: Matcher;
  poll_ms: number;
  timeout_ms: number;
  label?: string;
  created_at: number;
  pollTimer?: ReturnType<typeof setTimeout>;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  cancelled: boolean;
  pollCount: number;
};

export type WatchRegistryOptions = {
  minPollMs?: number;
  defaultPollMs?: number;
  defaultTimeoutMs?: number;
  // Override for tests; defaults to global setTimeout / clearTimeout.
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  // Override for tests; defaults to Date.now.
  nowFn?: () => number;
};

export class WatchRegistry {
  private entries = new Map<string, Entry>();
  private idCounter = 0;
  private setTimeoutFn: typeof setTimeout;
  private clearTimeoutFn: typeof clearTimeout;
  private nowFn: () => number;

  constructor(
    private poll: PollExecutor,
    private emit: (event: WatchEvent) => void,
    private options: WatchRegistryOptions = {},
  ) {
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.nowFn = options.nowFn ?? Date.now;
  }

  size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** List active watcher ids (for diagnostics — not part of the agent API). */
  list(): string[] {
    return Array.from(this.entries.keys());
  }

  register(args: WatchArgs): { watcher_id: string } {
    const source = validateSource(args as unknown as Record<string, unknown>);
    const matcher = validateMatcher(args.matcher);
    // Cross-validate matcher and source — `exists` only makes sense for vfs_path.
    if ("exists" in matcher && !("vfs_path" in source)) {
      throw new Error("matcher 'exists' is only valid with vfs_path");
    }
    const minPollMs = this.options.minPollMs ?? MIN_POLL_MS;
    const requestedPoll = args.poll_ms ?? this.options.defaultPollMs ?? DEFAULT_POLL_MS;
    const poll_ms = Math.max(minPollMs, requestedPoll);
    const timeout_ms = args.timeout_ms ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const id = `wat_${randomBytes(4).toString("hex")}_${++this.idCounter}`;
    const entry: Entry = {
      id,
      source,
      matcher,
      poll_ms,
      timeout_ms,
      label: args.label,
      created_at: this.nowFn(),
      inFlight: false,
      cancelled: false,
      pollCount: 0,
    };
    this.entries.set(id, entry);
    entry.deadlineTimer = this.setTimeoutFn(() => this.onTimeout(id), timeout_ms);
    // First poll fires on the next tick — register() must return immediately.
    entry.pollTimer = this.setTimeoutFn(() => {
      void this.tick(id);
    }, 0);
    return { watcher_id: id };
  }

  unregister(id: string): { ok: true; cancelled: boolean } {
    const entry = this.entries.get(id);
    if (!entry) return { ok: true, cancelled: false };
    entry.cancelled = true;
    if (entry.pollTimer) this.clearTimeoutFn(entry.pollTimer);
    if (entry.deadlineTimer) this.clearTimeoutFn(entry.deadlineTimer);
    this.entries.delete(id);
    return { ok: true, cancelled: true };
  }

  /** Cancel every active watcher (used on shutdown). No events emitted. */
  clear(): void {
    for (const id of Array.from(this.entries.keys())) this.unregister(id);
  }

  private async tick(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.cancelled) return;
    if (entry.inFlight) {
      entry.pollTimer = this.setTimeoutFn(() => {
        void this.tick(id);
      }, entry.poll_ms);
      return;
    }
    entry.inFlight = true;
    entry.pollCount++;
    let value: unknown;
    let pollFailed = false;
    try {
      value = await this.poll(entry.source);
    } catch {
      // Transient poll failure (engine error, file not found, bridge blip):
      // treat as "no match yet, retry". The timeout bounds total wait so a
      // permanently-broken source still wakes the agent via a timeout event.
      pollFailed = true;
    } finally {
      entry.inFlight = false;
    }
    // unregister() may have fired while the poll was in flight.
    if (!this.entries.has(id) || entry.cancelled) return;
    if (!pollFailed && evaluateMatcher(entry.matcher, value)) {
      // Tear down BEFORE emitting so the next-turn agent can't observe a
      // still-live entry of the same id.
      if (entry.pollTimer) this.clearTimeoutFn(entry.pollTimer);
      if (entry.deadlineTimer) this.clearTimeoutFn(entry.deadlineTimer);
      this.entries.delete(id);
      try {
        this.emit({
          type: "watcher.fired",
          watcher_id: id,
          label: entry.label,
          value,
          source: entry.source,
          matched_at: this.nowFn(),
        });
      } catch {
        // The emit channel is the host's problem — never let it kill the loop.
      }
      return;
    }
    entry.pollTimer = this.setTimeoutFn(() => {
      void this.tick(id);
    }, entry.poll_ms);
  }

  private onTimeout(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.cancelled) return;
    if (entry.pollTimer) this.clearTimeoutFn(entry.pollTimer);
    this.entries.delete(id);
    try {
      this.emit({
        type: "watcher.timeout",
        watcher_id: id,
        label: entry.label,
        source: entry.source,
        timeout_ms: entry.timeout_ms,
        fired_at: this.nowFn(),
      });
    } catch {
      // see tick()
    }
  }
}

// Canonical MCP tool schemas — the shared piece owns the contract so every
// host wrapper exposes the identical surface to the agent.
export const WATCH_TOOL_DEF = {
  name: "watch",
  description:
    "Register a non-blocking watcher on engine state and END YOUR TURN. " +
    "Polls the chosen source on a background timer; when the matcher fires, a host re-entry " +
    "event delivers the matched value to a NEW turn. " +
    "DO NOT loop on this — call once, get { watcher_id }, finish your turn. " +
    "To wait for a long-running execute() task: kick it, receive its { taskId }, then call " +
    "watch({ expr: 'return tasks.status(' .. taskId .. ')', matcher: { equals: 'finished' } }). " +
    "Other sources: vfs_path (a VFS file's existence/content) or status_field (sugar — evaluates " +
    "'return <field>'). Matchers (exactly one): equals (deep-equality on the polled value), " +
    "non_nil (value present), gte (numeric ≥ threshold), exists (vfs_path only — file present). " +
    "Returns { watcher_id } immediately; cancel it later with unwatch from a different turn.",
  inputSchema: {
    type: "object",
    properties: {
      expr: {
        type: "string",
        description:
          "A Luau snippet (e.g. 'return tasks.status(42)'). Its return value is matched.",
      },
      vfs_path: {
        type: "string",
        description: "VFS file path. Read each poll; existence/content is matched.",
      },
      status_field: {
        type: "string",
        description:
          "Shorthand for expr: 'return <status_field>' (e.g. 'tasks.status(42)').",
      },
      matcher: {
        type: "object",
        description:
          "Exactly one of: { equals: <value> }, { non_nil: true }, { gte: <number> }, { exists: true }.",
        properties: {
          equals: { description: "Deep-equality match (any JSON value)." },
          non_nil: { type: "boolean" },
          gte: { type: "number" },
          exists: { type: "boolean", description: "vfs_path only — file present." },
        },
      },
      poll_ms: {
        type: "integer",
        description: `Poll interval (ms). Default ${DEFAULT_POLL_MS}, minimum ${MIN_POLL_MS}.`,
      },
      timeout_ms: {
        type: "integer",
        description: `Max wait before firing watcher.timeout. Default ${DEFAULT_TIMEOUT_MS} (10 min).`,
      },
      label: {
        type: "string",
        description: "Optional label echoed back in the fire event for your benefit.",
      },
    },
    required: ["matcher"],
  },
} as const;

export const UNWATCH_TOOL_DEF = {
  name: "unwatch",
  description:
    "Cancel a watcher previously registered with watch. Safe to call from any turn AFTER the " +
    "watch turn — that is the whole point: watch is non-blocking so unwatch from a later turn " +
    "actually works. Returns { ok: true, cancelled: <bool> } (cancelled is false if the id " +
    "wasn't found, e.g. it already fired or was never registered).",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The watcher_id returned by watch." },
    },
    required: ["id"],
  },
} as const;

export const WATCH_NOTIFICATION_METHOD = "notifications/zeromind/watcher" as const;
