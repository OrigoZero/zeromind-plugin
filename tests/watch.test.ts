import { describe, it, expect, vi } from "vitest";
import {
  WatchRegistry,
  evaluateMatcher,
  validateMatcher,
  validateSource,
  type WatchEvent,
  type WatchSource,
} from "../src/watch.js";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("evaluateMatcher", () => {
  it("equals: deep-compares JSON-stringifiable values", () => {
    expect(evaluateMatcher({ equals: "finished" }, "finished")).toBe(true);
    expect(evaluateMatcher({ equals: "finished" }, "running")).toBe(false);
    expect(evaluateMatcher({ equals: 42 }, 42)).toBe(true);
    expect(
      evaluateMatcher({ equals: { a: 1, b: [1, 2] } }, { a: 1, b: [1, 2] }),
    ).toBe(true);
    expect(evaluateMatcher({ equals: null }, null)).toBe(true);
    expect(evaluateMatcher({ equals: null }, undefined)).toBe(false);
  });
  it("non_nil: fires on any non-null, non-undefined value", () => {
    expect(evaluateMatcher({ non_nil: true }, 0)).toBe(true);
    expect(evaluateMatcher({ non_nil: true }, "")).toBe(true);
    expect(evaluateMatcher({ non_nil: true }, false)).toBe(true);
    expect(evaluateMatcher({ non_nil: true }, null)).toBe(false);
    expect(evaluateMatcher({ non_nil: true }, undefined)).toBe(false);
  });
  it("gte: fires when value is a finite number ≥ threshold", () => {
    expect(evaluateMatcher({ gte: 100 }, 100)).toBe(true);
    expect(evaluateMatcher({ gte: 100 }, 99)).toBe(false);
    expect(evaluateMatcher({ gte: 0 }, -0.0001)).toBe(false);
    expect(evaluateMatcher({ gte: 0 }, Number.POSITIVE_INFINITY)).toBe(false);
    expect(evaluateMatcher({ gte: 0 }, "5" as unknown as number)).toBe(false);
  });
  it("exists: fires whenever value is not undefined", () => {
    expect(evaluateMatcher({ exists: true }, "")).toBe(true);
    expect(evaluateMatcher({ exists: true }, null)).toBe(true);
    expect(evaluateMatcher({ exists: true }, undefined)).toBe(false);
  });
});

describe("validateMatcher / validateSource", () => {
  it("rejects empty matcher", () => {
    expect(() => validateMatcher({})).toThrow(/one of/);
    expect(() => validateMatcher(null)).toThrow(/object/);
  });
  it("rejects multi-key matcher", () => {
    expect(() => validateMatcher({ equals: 1, gte: 2 })).toThrow(/exactly one/);
  });
  it("accepts valid matchers", () => {
    expect(validateMatcher({ equals: "x" })).toEqual({ equals: "x" });
    expect(validateMatcher({ gte: 5 })).toEqual({ gte: 5 });
  });
  it("rejects missing source", () => {
    expect(() => validateSource({})).toThrow(/exactly one of/);
  });
  it("rejects multi-source", () => {
    expect(() => validateSource({ expr: "return 1", vfs_path: "/a" })).toThrow(
      /exactly one of/,
    );
  });
});

describe("WatchRegistry", () => {
  const mkRegistry = (
    poll: (source: WatchSource) => Promise<unknown>,
    emit: (event: WatchEvent) => void,
  ) =>
    new WatchRegistry(poll, emit, {
      minPollMs: 5,
      defaultPollMs: 10,
      defaultTimeoutMs: 1_000,
    });

  // Drop the initial "watching" state emit so each test asserts only the
  // terminal events (fired / timeout) it cares about.
  const terminal = (events: WatchEvent[]): WatchEvent[] =>
    events.filter((e) => e.state !== "watching");

  it("register returns immediately and never blocks on the poll", async () => {
    let pollResolve: ((v: unknown) => void) | undefined;
    const slow = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          pollResolve = resolve;
        }),
    );
    const emit = vi.fn();
    const reg = mkRegistry(slow, emit);
    const t0 = Date.now();
    const { watcher_id } = reg.register({
      expr: "return 1",
      matcher: { equals: 1 },
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(watcher_id).toMatch(/^wat_/);
    expect(reg.has(watcher_id)).toBe(true);
    // Let the scheduled first poll fire so the in-flight promise exists,
    // then resolve it so the test doesn't leak a hanging promise.
    await wait(20);
    expect(slow).toHaveBeenCalled();
    pollResolve?.(1);
    await wait(20);
    reg.clear();
  });

  it("emits an initial 'watching' state synchronously on register", () => {
    const poll = vi.fn(async () => "running");
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const { watcher_id } = reg.register({
      status_field: "tasks.status(99)",
      matcher: { equals: "finished" },
      label: "boot",
    });
    // Watching event present before any poll runs.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      state: "watching",
      watcher_id,
      label: "boot",
      poll_count: 0,
      matcher: { equals: "finished" },
      source: { status_field: "tasks.status(99)" },
    });
    reg.unregister(watcher_id);
  });

  it("fires watcher.fired with the matched value when equals matches", async () => {
    let n = 0;
    const poll = vi.fn(async () => {
      n++;
      return n >= 3 ? "finished" : "running";
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const { watcher_id } = reg.register({
      status_field: "tasks.status(42)",
      matcher: { equals: "finished" },
      label: "task-42",
    });
    await wait(150);
    expect(terminal(events)).toHaveLength(1);
    expect(terminal(events)[0]).toMatchObject({
      state: "fired",
      watcher_id,
      label: "task-42",
      value: "finished",
      source: { status_field: "tasks.status(42)" },
    });
    expect(reg.has(watcher_id)).toBe(false);
  });

  it("fires on non_nil after a few null polls", async () => {
    let n = 0;
    const poll = vi.fn(async () => (++n >= 2 ? "anything" : null));
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({ expr: "return v", matcher: { non_nil: true } });
    await wait(100);
    expect(terminal(events)).toHaveLength(1);
    expect(terminal(events)[0].state).toBe("fired");
    expect((terminal(events)[0] as { value: unknown }).value).toBe("anything");
  });

  it("fires on gte when the polled number crosses the threshold", async () => {
    let n = 0;
    const poll = vi.fn(async () => (n += 50));
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({ expr: "return frame", matcher: { gte: 100 } });
    await wait(100);
    expect(terminal(events)).toHaveLength(1);
    expect((terminal(events)[0] as { value: unknown }).value).toBeGreaterThanOrEqual(100);
  });

  it("retries on poll error, then fires once the value arrives", async () => {
    let n = 0;
    const poll = vi.fn(async () => {
      n++;
      if (n < 3) throw new Error("transient");
      return "ok";
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({ expr: "return x", matcher: { equals: "ok" } });
    await wait(150);
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(terminal(events)).toHaveLength(1);
    expect(terminal(events)[0].state).toBe("fired");
  });

  it("emits watcher.timeout when the matcher never fires", async () => {
    const poll = vi.fn(async () => "still-running");
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const { watcher_id } = reg.register({
      expr: "return s",
      matcher: { equals: "finished" },
      timeout_ms: 60,
    });
    await wait(150);
    expect(terminal(events)).toHaveLength(1);
    expect(terminal(events)[0]).toMatchObject({
      state: "timeout",
      watcher_id,
      timeout_ms: 60,
    });
    expect(reg.has(watcher_id)).toBe(false);
  });

  it("unregister cancels a pending watcher and no events are ever emitted", async () => {
    let pollCalls = 0;
    const poll = vi.fn(async () => {
      pollCalls++;
      return "running";
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const { watcher_id } = reg.register({
      expr: "return s",
      matcher: { equals: "finished" },
      timeout_ms: 1_000,
    });
    await wait(50);
    expect(pollCalls).toBeGreaterThan(0);
    const callsAtCancel = pollCalls;
    const res = reg.unregister(watcher_id);
    expect(res).toEqual({ ok: true, cancelled: true });
    await wait(150);
    // No further polls scheduled, no events.
    expect(pollCalls).toBeLessThanOrEqual(callsAtCancel + 1);
    expect(terminal(events)).toHaveLength(0);
    expect(reg.has(watcher_id)).toBe(false);
  });

  it("unregister of an unknown id is a no-op", () => {
    const reg = mkRegistry(
      async () => undefined,
      () => undefined,
    );
    expect(reg.unregister("nope")).toEqual({ ok: true, cancelled: false });
  });

  it("unregister during an in-flight poll prevents the fire emit", async () => {
    let resolvePoll: ((v: unknown) => void) | undefined;
    const poll = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const { watcher_id } = reg.register({
      expr: "return s",
      matcher: { equals: "finished" },
    });
    // Let the first poll dispatch.
    await wait(20);
    expect(poll).toHaveBeenCalled();
    // Cancel while the poll is in flight.
    reg.unregister(watcher_id);
    // Resolve the poll with a value that WOULD have matched.
    resolvePoll?.("finished");
    await wait(50);
    expect(terminal(events)).toHaveLength(0);
  });

  it("multiple watchers run independently", async () => {
    const valueByExpr: Record<string, unknown> = {
      "return a": "no",
      "return b": "yes",
    };
    const poll = vi.fn(async (s: WatchSource) =>
      "expr" in s ? valueByExpr[s.expr] : undefined,
    );
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    const a = reg.register({ expr: "return a", matcher: { equals: "yes" }, timeout_ms: 80 });
    const b = reg.register({ expr: "return b", matcher: { equals: "yes" } });
    await wait(150);
    const byId = new Map(terminal(events).map((e) => [e.watcher_id, e]));
    expect(byId.get(a.watcher_id)?.state).toBe("timeout");
    expect(byId.get(b.watcher_id)?.state).toBe("fired");
    expect((byId.get(b.watcher_id) as { value?: unknown }).value).toBe("yes");
  });

  it("validates source / matcher cross-constraints (exists requires vfs_path)", () => {
    const reg = mkRegistry(
      async () => undefined,
      () => undefined,
    );
    expect(() =>
      reg.register({ expr: "return 1", matcher: { exists: true } }),
    ).toThrow(/vfs_path/);
  });

  it("enforces a minimum poll interval", async () => {
    const poll = vi.fn(async () => "running");
    const reg = mkRegistry(poll, () => undefined);
    reg.register({
      expr: "return s",
      matcher: { equals: "finished" },
      poll_ms: 1, // under the minPollMs of 5
      timeout_ms: 100,
    });
    await wait(120);
    // With min=5, in ~100ms we should see <30 polls (closer to 20). The
    // exact count varies by scheduler, so we just assert it didn't go wild.
    expect(poll.mock.calls.length).toBeLessThan(60);
  });

  it("fired event carries matcher, timestamps, and poll_count — but no poll history", async () => {
    let n = 0;
    const poll = vi.fn(async () => {
      n++;
      return n >= 4 ? "finished" : "running";
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({
      status_field: "tasks.status(42)",
      matcher: { equals: "finished" },
      label: "task-42",
    });
    await wait(150);
    expect(terminal(events)).toHaveLength(1);
    const event = terminal(events)[0] as Extract<WatchEvent, { state: "fired" }>;
    expect(event.state).toBe("fired");
    expect(event.matcher).toEqual({ equals: "finished" });
    expect(event.poll_count).toBeGreaterThanOrEqual(4);
    expect(event.started_at).toBeLessThanOrEqual(event.matched_at);
    // The fire payload is the wake signal, not a log dump. Per-poll history
    // is intentionally absent — agent reads engine logs directly if it cares.
    expect(event).not.toHaveProperty("polls");
    expect(event).not.toHaveProperty("polls_truncated");
  });

  it("timeout event carries matcher and poll_count too", async () => {
    const poll = vi.fn(async () => "stuck");
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({
      expr: "return s",
      matcher: { equals: "done" },
      timeout_ms: 80,
    });
    await wait(150);
    expect(terminal(events)).toHaveLength(1);
    const event = terminal(events)[0] as Extract<WatchEvent, { state: "timeout" }>;
    expect(event.state).toBe("timeout");
    expect(event.poll_count).toBeGreaterThan(0);
    expect(event.timeout_ms).toBe(80);
    expect(event.matcher).toEqual({ equals: "done" });
    expect(event).not.toHaveProperty("polls");
  });

  it("timeout event includes last_value when last poll returned successfully", async () => {
    const poll = vi.fn(async () => "still-running");
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({
      expr: "return s",
      matcher: { equals: "finished" },
      timeout_ms: 80,
    });
    await wait(150);
    const event = terminal(events)[0] as Extract<WatchEvent, { state: "timeout" }>;
    expect(event.last_value).toBe("still-running");
    expect(event.last_error).toBeUndefined();
  });

  it("timeout event includes last_error when last poll threw", async () => {
    const poll = vi.fn(async () => {
      throw new Error("bridge disconnected");
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({
      expr: "return s",
      matcher: { equals: "ok" },
      timeout_ms: 80,
    });
    await wait(150);
    const event = terminal(events)[0] as Extract<WatchEvent, { state: "timeout" }>;
    expect(event.last_error).toBe("bridge disconnected");
    expect(event.last_value).toBeUndefined();
  });

  it("timeout's last_* tracks whichever poll happened MOST recently", async () => {
    // Alternates: succeed, fail, succeed, fail, ...
    let n = 0;
    const poll = vi.fn(async () => {
      n++;
      if (n % 2 === 1) return "value-" + n;
      throw new Error("error-" + n);
    });
    const events: WatchEvent[] = [];
    const reg = mkRegistry(poll, (e) => events.push(e));
    reg.register({
      expr: "return s",
      matcher: { equals: "never" },
      timeout_ms: 80,
    });
    await wait(150);
    const event = terminal(events)[0] as Extract<WatchEvent, { state: "timeout" }>;
    // Exactly one of last_value / last_error is populated.
    const hasValue = event.last_value !== undefined;
    const hasError = event.last_error !== undefined;
    expect(hasValue !== hasError).toBe(true);
  });
});
