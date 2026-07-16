import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectPromotion,
  terminalStatusExpr,
  rewritePromotion,
  AutoWatchIndex,
  applyAutoWatch,
} from "../src/tools/auto-watch.js";
import { sweepStaleFireFiles } from "../src/tools/watch.js";

describe("detectPromotion", () => {
  it("detects the running envelope", () => {
    expect(
      detectPromotion({ status: "running", taskId: 42, location: "/runtime/tasks/active/42" }),
    ).toEqual({ taskId: 42, location: "/runtime/tasks/active/42" });
  });
  it("ignores a success envelope", () => {
    expect(detectPromotion({ result: "finished", state: { mode: "edit" } })).toBeNull();
  });
  it("ignores bare values", () => {
    expect(detectPromotion(42)).toBeNull();
    expect(detectPromotion(null)).toBeNull();
  });
});

describe("terminalStatusExpr", () => {
  it("matches all three terminal states via tasks.status", () => {
    const e = terminalStatusExpr(7);
    expect(e).toContain("tasks.status(7)");
    expect(e).toContain("finished");
    expect(e).toContain("failed");
    expect(e).toContain("cancelled");
  });
});

describe("rewritePromotion", () => {
  it("names the file, states, and preserves metadata", () => {
    const out = rewritePromotion(42, "/home/u/.zeromind/watch/wat_x.json", "wat_x");
    expect(out.text).toContain("wat_x.json");
    expect(out.text).toContain("finished");
    expect(out.text).toContain("failed");
    expect(out.text).toContain("cancelled");
    expect(out.text).toContain("tasks.result(42)");
    expect(out._meta).toEqual({
      taskId: 42,
      watcher_id: "wat_x",
      fire_path: "/home/u/.zeromind/watch/wat_x.json",
      state: "watching",
    });
  });
});

describe("AutoWatchIndex", () => {
  it("is idempotent per taskId", () => {
    const idx = new AutoWatchIndex();
    expect(idx.claim(42, "wat_a")).toBe(true);
    expect(idx.existing(42)).toBe("wat_a");
    expect(idx.claim(42, "wat_b")).toBe(false);
    expect(idx.claim(43, "wat_c")).toBe(true);
    idx.release(42);
    expect(idx.existing(42)).toBeUndefined();
  });
});

// A fake WatchTools with just the two methods applyAutoWatch uses.
const fakeWt = () => {
  const calls: unknown[] = [];
  return {
    calls,
    registerRaw(args: unknown) {
      calls.push(args);
      return {
        watcher_id: "wat_z",
        fire_path: "/tmp/.zeromind/watch/wat_z.json",
        wake_instructions: "",
      };
    },
    fireFilePath: (id: string) => `/tmp/.zeromind/watch/${id}.json`,
  } as any;
};

describe("applyAutoWatch", () => {
  it("registers once and reuses on re-promotion", () => {
    const idx = new AutoWatchIndex();
    const wt = fakeWt();
    const promo = { status: "running", taskId: 99 };
    const first = applyAutoWatch(promo, wt, idx) as any;
    expect(first._meta.watcher_id).toBe("wat_z");
    expect(first.handoff).toContain("wat_z.json");
    expect(wt.calls.length).toBe(1);
    // Re-promotion of the same task registers nothing new.
    const second = applyAutoWatch(promo, wt, idx) as any;
    expect(second._meta.watcher_id).toBe("wat_z");
    expect(wt.calls.length).toBe(1);
  });
  it("passes non-promotions through untouched", () => {
    const idx = new AutoWatchIndex();
    const wt = fakeWt();
    const val = { result: 5, state: {} };
    expect(applyAutoWatch(val, wt, idx)).toBe(val);
    expect(wt.calls.length).toBe(0);
  });
});

describe("sweepStaleFireFiles", () => {
  it("removes old fire files, keeps fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "zsweep-"));
    const old = join(dir, "wat_old.json");
    const fresh = join(dir, "wat_fresh.json");
    writeFileSync(old, "{}");
    writeFileSync(fresh, "{}");
    const longAgo = Date.now() / 1000 - 60 * 60 * 48;
    utimesSync(old, longAgo, longAgo);
    sweepStaleFireFiles(dir, 60 * 60 * 24 * 1000);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
