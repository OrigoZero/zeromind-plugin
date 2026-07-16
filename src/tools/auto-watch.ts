// Auto-watch on task promotion (plugin mirror of zero's auto_watch.rs).
//
// A promoting execute/bash/use_tool call returns
// { status: "running", taskId, location, ... }. This module recognises that
// envelope, provides the terminal-status watcher expression, rewrites the
// agent-facing response into a "task saved to <file>; watch for
// finished/failed/cancelled" handoff, and tracks taskId→watcher_id so a `wait`
// re-promotion doesn't spawn a second watcher. The plugin's Luau status surface
// is `tasks.status` / `tasks.result` (plural).

import type { WatchTools } from "./watch.js";

export type Promotion = { taskId: number; location: string };

/** Detect a promotion in a raw engine result. A genuine promotion is the
 *  TOP-LEVEL result object with status/taskId/location directly — never nested
 *  under an execute envelope's `result`. So check the object directly (NOT via
 *  unwrapEngineValue): a normal inline completion whose return value happens to
 *  be {status:"running",taskId} (which the engine wraps as {result:{...},state})
 *  must not be misread as a promotion and its real result clobbered. */
export const detectPromotion = (result: unknown): Promotion | null => {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const o = result as Record<string, unknown>;
  if (o.status !== "running") return null;
  if (typeof o.taskId !== "number") return null;
  // Real promotions always carry the task location; require it so an arbitrary
  // object with a status/taskId shape can't trip detection.
  if (typeof o.location !== "string" || o.location.length === 0) return null;
  return { taskId: o.taskId, location: o.location };
};

/** The Luau expr the promotion's watcher polls — resolves to the terminal
 *  status string or nil while active (matcher: non_nil). */
export const terminalStatusExpr = (taskId: number): string =>
  `local s = tasks.status(${taskId}); ` +
  `return (s=='finished' or s=='failed' or s=='cancelled') and s or nil`;

export type PromotionRewrite = {
  text: string;
  _meta: { taskId: number; watcher_id: string; fire_path: string; state: "watching" };
};

/** Build the rewritten agent-facing handoff for a promotion. */
export const rewritePromotion = (
  taskId: number,
  firePath: string,
  watcherId: string,
): PromotionRewrite => ({
  text:
    `Call exceeded the inline threshold; promoted to background task ${taskId}. Monitor ` +
    `${firePath} for its state to become "fired" (value "finished" / "failed" / "cancelled") or ` +
    `"timeout", then read tasks.result(${taskId}).`,
  _meta: { taskId, watcher_id: watcherId, fire_path: firePath, state: "watching" },
});

/** taskId → watcher_id, so a repeated promotion of the same task reuses its
 *  watcher. One index per connected engine session (reset on disconnect). */
export class AutoWatchIndex {
  private map = new Map<number, string>();
  existing(taskId: number): string | undefined {
    return this.map.get(taskId);
  }
  claim(taskId: number, watcherId: string): boolean {
    if (this.map.has(taskId)) return false;
    this.map.set(taskId, watcherId);
    return true;
  }
  release(taskId: number): void {
    this.map.delete(taskId);
  }
  clear(): void {
    this.map.clear();
  }
}

/** If `result` is a promotion, register (or reuse) its watcher and return the
 *  rewritten handoff object; otherwise return `result` unchanged. */
export const applyAutoWatch = (
  result: unknown,
  wt: WatchTools,
  index: AutoWatchIndex,
): unknown => {
  const promo = detectPromotion(result);
  if (!promo) return result;
  let watcherId = index.existing(promo.taskId);
  let firePath: string;
  if (watcherId) {
    firePath = wt.fireFilePath(watcherId);
  } else {
    const reg = wt.registerRaw({
      expr: terminalStatusExpr(promo.taskId),
      matcher: { non_nil: true },
      label: `auto:task:${promo.taskId}`,
    });
    watcherId = reg.watcher_id;
    firePath = reg.fire_path;
    index.claim(promo.taskId, watcherId);
  }
  const rw = rewritePromotion(promo.taskId, firePath, watcherId);
  return {
    status: "running",
    taskId: promo.taskId,
    location: promo.location,
    handoff: rw.text,
    _meta: rw._meta,
  };
};
