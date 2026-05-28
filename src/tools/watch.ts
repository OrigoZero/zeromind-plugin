// Engine-bridge adapter for the generic WatchRegistry.
//
// Maps a WatchSource to a concrete bridge call: `expr` / `status_field` go
// through execute(); `vfs_path` goes through read_file(). The result is fed
// back to the registry's matcher.

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

const unwrapEngineValue = (result: unknown): unknown => {
  // engine.execute commonly returns `{ value: <user-return> }`; unwrap one
  // level so the agent can write `matcher: { equals: 'finished' }` against
  // a Luau `return 'finished'`. We only unwrap when the object's sole key
  // is `value` — otherwise the agent likely cares about the whole shape.
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "value" in (result as object) &&
    Object.keys(result as object).length === 1
  ) {
    return (result as { value: unknown }).value;
  }
  return result;
};

export class WatchTools {
  readonly registry: WatchRegistry;

  constructor(
    engine: EngineTools,
    emit: (event: WatchEvent) => void,
    options?: ConstructorParameters<typeof WatchRegistry>[2],
  ) {
    const poll = async (source: WatchSource): Promise<unknown> => {
      if ("vfs_path" in source) {
        // A throw here (NotFound / NotConnected / bridge blip) is treated by
        // the registry as "no match yet, retry"; the watcher's timeout bounds
        // total wait so a permanently-missing file still wakes the agent.
        const r = (await engine.read_file({ path: source.vfs_path })) as ReadFileResult;
        // For `exists`, any successful read counts as present. For
        // `equals` / `non_nil`, the matcher gets the textual content.
        return r.content ?? r.content_b64 ?? "";
      }
      const code = buildExpr(source);
      const result = await engine.execute({ code });
      return unwrapEngineValue(result);
    };
    this.registry = new WatchRegistry(poll, emit, options);
  }

  watch(args: WatchArgs): { watcher_id: string } {
    return this.registry.register(args);
  }

  unwatch(args: { id?: string; watcher_id?: string }): { ok: true; cancelled: boolean } {
    const id = args.id ?? args.watcher_id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("unwatch: 'id' is required");
    }
    return this.registry.unregister(id);
  }

  /** Stop every active watcher (called on shutdown / disconnect). */
  shutdown(): void {
    this.registry.clear();
  }
}
