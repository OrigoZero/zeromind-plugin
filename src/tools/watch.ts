// Engine-bridge adapter for the generic WatchRegistry, plus the file-based
// wake-up channel.
//
// State files live under `~/.zeromind/watch/<watcher_id>.json` — the
// `.zeromind` directory name unambiguously flags them as host-local plugin
// state (not engine VFS), and the location is stable across reboots so an
// agent that lost context can `ls ~/.zeromind/watch/` to see what's live.
// Each file:
//   - Is written on register() with `{state: "watching", ...}`.
//   - Is rewritten atomically (write-tmp + rename) when the matcher resolves:
//     `{state: "fired", value, ...}` or `{state: "timeout", ...}`.
//   - Is deleted by unwatch().
// An MCP notification (`notifications/zeromind/watcher`) also fires for
// terminal states as a safety net for any host that picks it up directly.
//
// The plugin makes no assumptions about how the agent reacts to the file.
// Agents know their own runtimes — Monitor, ScheduleWakeup, a background
// shell, a file watcher, or just reading it next time they run.

import { writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import type { EngineTools } from "./engine.js";
import {
  WatchRegistry,
  type WatchArgs,
  type WatchEvent,
  type WatchSource,
} from "../watch.js";

type ReadFileResult = { content?: string; content_b64?: string };

const buildExpr = (source: WatchSource): string => {
  if ("expr" in source) return source.expr;
  if ("status_field" in source) return `return ${source.status_field}`;
  throw new Error("buildExpr expects expr or status_field");
};

export const unwrapEngineValue = (result: unknown): unknown => {
  // Unwrap the engine's execute response down to the script's return value so
  // the agent can write `matcher: { equals: 'finished' }` against a Luau
  // `return 'finished'`. Two wire shapes exist:
  //
  // 1. Envelope (engines from zero PR #3941 onward): execute ALWAYS returns
  //    `{ result: <user-return>, logs?: [...], diagnostics?: [...],
  //       state: {...} }`. Unwrap `result` ONLY when at least one marker key
  //    (`state` / `logs` / `diagnostics`) is present — a script returning its
  //    own `{ result = ... }` table without markers must NOT be unwrapped.
  //    (Mirrors `unwrap_execute_envelope` in zero's
  //    crates/zero_proxy_mcp/src/envelope.rs.)
  // 2. Legacy `{ value: <user-return> }` with `value` as the sole key
  //    (pre-envelope engines). Kept for backward compatibility.
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (
      "result" in obj &&
      ("state" in obj || "logs" in obj || "diagnostics" in obj)
    ) {
      return obj.result;
    }
    if ("value" in obj && Object.keys(obj).length === 1) {
      return obj.value;
    }
  }
  return result;
};

export const defaultWatchDir = (): string => join(homedir(), ".zeromind", "watch");

export const fireFilePathFor = (watcherId: string, baseDir?: string): string =>
  join(baseDir ?? defaultWatchDir(), `${watcherId}.json`);

const writeFireFile = (path: string, payload: WatchEvent): void => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  // Atomic publish: write to .tmp then rename, so the host's file watcher
  // never sees a half-written file. JSON pretty-printed because the agent
  // reads it as conversation context — readability > byte count.
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
};

const cleanupFireFile = (path: string): void => {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // best-effort — a stale file is harmless, the watcher_id won't be reused
  }
};

const wakeInstructions = (firePath: string, label?: string): string => {
  const id = label ? `"${label}" ` : "";
  return (
    `Watcher ${id}registered. State file: ${firePath} on the host's local filesystem. ` +
    `Holds {state: "watching", ...} now; updates to {state: "fired", value, ...} or ` +
    `{state: "timeout", last_value | last_error, ...} when the matcher resolves. ` +
    `Read it any time, or watch it with available tooling.`
  );
};

export type WatchRegisterResult = {
  watcher_id: string;
  fire_path: string;
  wake_instructions: string;
};

export type WatchToolsOptions = {
  fireDir?: string;
  registry?: ConstructorParameters<typeof WatchRegistry>[2];
};

export class WatchTools {
  readonly registry: WatchRegistry;
  private readonly fireDir?: string;

  constructor(
    engine: EngineTools,
    emitNotification: (event: WatchEvent) => void,
    options: WatchToolsOptions = {},
  ) {
    this.fireDir = options.fireDir;
    const poll = async (source: WatchSource): Promise<unknown> => {
      if ("vfs_path" in source) {
        const r = (await engine.read_file({ path: source.vfs_path })) as ReadFileResult;
        return r.content ?? r.content_b64 ?? "";
      }
      const code = buildExpr(source);
      const result = await engine.execute({ code });
      return unwrapEngineValue(result);
    };
    // Every state transition (watching / fired / timeout) rewrites the file
    // atomically. The MCP notification is only sent for terminal transitions
    // (fired / timeout) — registration is synchronous and the agent already
    // got the watcher_id from watch()'s return; no notification needed there.
    // Either channel failing must not block the other.
    const emit = (event: WatchEvent): void => {
      try {
        writeFireFile(fireFilePathFor(event.watcher_id, this.fireDir), event);
      } catch {
        // file write failure: the notification (if it goes through) is the
        // only signal; otherwise the watcher is effectively orphaned.
      }
      if (event.state === "watching") return;
      try {
        emitNotification(event);
      } catch {
        // notification failure is non-fatal — the file is the real channel.
      }
    };
    this.registry = new WatchRegistry(poll, emit, options.registry);
  }

  watch(args: WatchArgs): WatchRegisterResult {
    const { watcher_id } = this.registry.register(args);
    const fire_path = fireFilePathFor(watcher_id, this.fireDir);
    return {
      watcher_id,
      fire_path,
      wake_instructions: wakeInstructions(fire_path, args.label),
    };
  }

  /** Register a watcher directly (used by auto-watch on promotion). Returns the
   *  same shape as watch() but takes explicit WatchArgs. */
  registerRaw(args: WatchArgs): WatchRegisterResult {
    return this.watch(args);
  }

  /** Absolute fire-file path for a watcher id (auto-watch reuse path). */
  fireFilePath(watcherId: string): string {
    return fireFilePathFor(watcherId, this.fireDir);
  }

  unwatch(args: { id?: string; watcher_id?: string }): { ok: true; cancelled: boolean } {
    const id = args.id ?? args.watcher_id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("unwatch: 'id' is required");
    }
    const res = this.registry.unregister(id);
    // Clean up the fire file if one was already written (rare — fire usually
    // wakes the agent before it gets a chance to unwatch). Safe no-op if absent.
    cleanupFireFile(fireFilePathFor(id, this.fireDir));
    return res;
  }

  /** Stop every active watcher and remove their fire files (used on shutdown). */
  shutdown(): void {
    for (const id of this.registry.list()) {
      cleanupFireFile(fireFilePathFor(id, this.fireDir));
    }
    this.registry.clear();
  }
}
