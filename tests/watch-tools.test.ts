// Tests for the file-based wake-up channel that WatchTools layers on top of
// the generic WatchRegistry. Plugin contract with the agent:
//
//   watch(...) → { watcher_id, fire_path, wake_instructions }
//
// When the matcher fires (or times out), the plugin writes a small completion
// event JSON to `fire_path` atomically. `wake_instructions` is host-agnostic
// — it states the fact (watcher started, result lands at <path>) and leaves
// the agent to pick whatever tool its runtime exposes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WatchTools, fireFilePathFor } from "../src/tools/watch.js";
import type { EngineTools } from "../src/tools/engine.js";
import type { WatchEvent } from "../src/watch.js";

const wait = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// Minimal fake EngineTools — only the two methods WatchTools actually calls
// (execute, read_file). Each test wires up the responses it needs.
type FakeEngine = {
  engine: EngineTools;
  setExecuteHandler: (h: (code: string) => unknown) => void;
  setReadFileHandler: (h: (path: string) => { content?: string; content_b64?: string }) => void;
};

const makeFakeEngine = (): FakeEngine => {
  let executeHandler: (code: string) => unknown = () => undefined;
  let readFileHandler: (path: string) => { content?: string; content_b64?: string } =
    () => ({ content: "" });
  const engine = {
    execute: async ({ code }: { code: string }) => executeHandler(code),
    read_file: async ({ path }: { path: string }) => readFileHandler(path),
  } as unknown as EngineTools;
  return {
    engine,
    setExecuteHandler: (h) => {
      executeHandler = h;
    },
    setReadFileHandler: (h) => {
      readFileHandler = h;
    },
  };
};

describe("WatchTools — file-based wake-up channel", () => {
  let fireDir: string;
  const fastRegistry = { minPollMs: 5, defaultPollMs: 10, defaultTimeoutMs: 1_000 };

  beforeEach(() => {
    fireDir = mkdtempSync(join(tmpdir(), "zeromind-fire-"));
  });

  afterEach(() => {
    rmSync(fireDir, { recursive: true, force: true });
  });

  it("watch() returns watcher_id, fire_path, and wake_instructions immediately", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "running" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const t0 = Date.now();
    const res = tools.watch({
      status_field: "tasks.status(1)",
      matcher: { equals: "finished" },
      label: "demo",
    });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(res.watcher_id).toMatch(/^wat_/);
    expect(res.fire_path).toBe(fireFilePathFor(res.watcher_id, fireDir));
    expect(res.wake_instructions).toContain(res.fire_path);
    expect(res.wake_instructions).toContain('"demo"');
    tools.shutdown();
  });

  it("file exists immediately after watch() with state 'watching'", () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "running" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      status_field: "tasks.status(5)",
      matcher: { equals: "finished" },
      label: "boot",
    });
    expect(existsSync(res.fire_path)).toBe(true);
    const payload = JSON.parse(readFileSync(res.fire_path, "utf8")) as WatchEvent;
    expect(payload.state).toBe("watching");
    expect(payload.watcher_id).toBe(res.watcher_id);
    expect(payload.label).toBe("boot");
    expect(payload.poll_count).toBe(0);
    tools.shutdown();
  });

  it("on fire, writes a minimal completion event JSON to fire_path atomically", async () => {
    const fake = makeFakeEngine();
    let n = 0;
    fake.setExecuteHandler(() => {
      n++;
      return { value: n >= 3 ? "finished" : "running" };
    });
    const notifications: WatchEvent[] = [];
    const tools = new WatchTools(
      fake.engine,
      (event) => notifications.push(event),
      { fireDir, registry: fastRegistry },
    );
    const res = tools.watch({
      status_field: "tasks.status(42)",
      matcher: { equals: "finished" },
      label: "task-42",
    });
    // File exists from register() with state "watching".
    expect(existsSync(res.fire_path)).toBe(true);
    expect(
      (JSON.parse(readFileSync(res.fire_path, "utf8")) as WatchEvent).state,
    ).toBe("watching");

    await wait(150);

    expect(existsSync(res.fire_path)).toBe(true);
    const payload = JSON.parse(readFileSync(res.fire_path, "utf8")) as WatchEvent;
    expect(payload.state).toBe("fired");
    expect(payload.watcher_id).toBe(res.watcher_id);
    expect(payload.label).toBe("task-42");
    expect((payload as Extract<WatchEvent, { state: "fired" }>).value).toBe("finished");
    expect(payload.matcher).toEqual({ equals: "finished" });
    expect(payload.poll_count).toBeGreaterThanOrEqual(3);
    // Minimal payload: no per-poll log dump. Agent reads engine logs directly.
    expect(payload).not.toHaveProperty("polls");
    // Safety-net notification ALSO fired with the same payload.
    expect(notifications).toHaveLength(1);
    expect(notifications[0].watcher_id).toBe(res.watcher_id);
    tools.shutdown();
  });

  it("on timeout, writes a minimal timeout event with last_value", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "never" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      expr: "return tasks.status(7)",
      matcher: { equals: "done" },
      timeout_ms: 60,
    });
    await wait(150);
    expect(existsSync(res.fire_path)).toBe(true);
    const payload = JSON.parse(readFileSync(res.fire_path, "utf8")) as Extract<
      WatchEvent,
      { state: "timeout" }
    >;
    expect(payload.state).toBe("timeout");
    expect(payload.poll_count).toBeGreaterThan(0);
    expect(payload.last_value).toBe("never");
    expect(payload.last_error).toBeUndefined();
    expect(payload).not.toHaveProperty("polls");
    tools.shutdown();
  });

  it("on timeout with a broken source, writes last_error", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => {
      throw new Error("bridge disconnected");
    });
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      expr: "return s",
      matcher: { equals: "ok" },
      timeout_ms: 60,
    });
    await wait(150);
    const payload = JSON.parse(readFileSync(res.fire_path, "utf8")) as Extract<
      WatchEvent,
      { state: "timeout" }
    >;
    expect(payload.last_error).toBe("bridge disconnected");
    expect(payload.last_value).toBeUndefined();
    tools.shutdown();
  });

  it("vfs_path source reads the file each poll", async () => {
    const fake = makeFakeEngine();
    let nReads = 0;
    fake.setReadFileHandler(() => {
      nReads++;
      if (nReads < 3) throw new Error("not_found");
      return { content: "hello" };
    });
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      vfs_path: "/zero/output.txt",
      matcher: { exists: true },
    });
    await wait(150);
    expect(existsSync(res.fire_path)).toBe(true);
    const payload = JSON.parse(readFileSync(res.fire_path, "utf8")) as WatchEvent;
    expect(payload.state).toBe("fired");
    expect((payload as Extract<WatchEvent, { state: "fired" }>).value).toBe("hello");
    tools.shutdown();
  });

  it("unwatch from a later turn cancels polling AND deletes the state file", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "running" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      expr: "return s",
      matcher: { equals: "finished" },
      timeout_ms: 5_000,
    });
    // The watching-state file is there from register().
    expect(existsSync(res.fire_path)).toBe(true);
    await wait(40); // let a couple polls happen
    const cancel = tools.unwatch({ id: res.watcher_id });
    expect(cancel).toEqual({ ok: true, cancelled: true });
    // File removed by unwatch — even if the engine flips to the match value
    // afterward, no terminal state file ever materializes.
    expect(existsSync(res.fire_path)).toBe(false);
    fake.setExecuteHandler(() => ({ value: "finished" }));
    await wait(100);
    expect(existsSync(res.fire_path)).toBe(false);
    tools.shutdown();
  });

  it("unwatch after a fire cleans up the existing fire file", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "finished" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      expr: "return s",
      matcher: { equals: "finished" },
    });
    await wait(60);
    expect(existsSync(res.fire_path)).toBe(true);
    const after = tools.unwatch({ id: res.watcher_id });
    // The registry already removed the entry on fire, so cancelled is false —
    // but the file cleanup still runs.
    expect(after.cancelled).toBe(false);
    expect(existsSync(res.fire_path)).toBe(false);
    tools.shutdown();
  });

  it("wake_instructions is facts-only — no prescription on which tool to use", () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "x" }));
    const tools = new WatchTools(fake.engine, () => undefined, {
      fireDir,
      registry: fastRegistry,
    });
    const r = tools.watch({
      expr: "return 1",
      matcher: { equals: 1 },
      label: "demo",
    });
    expect(r.wake_instructions).toContain(r.fire_path);
    expect(r.wake_instructions).toContain('"demo"');
    // No prescription about HOW to react — the agent picks Monitor,
    // ScheduleWakeup, a background shell, polling on next prompt, or
    // something we don't know about. Only facts about what's set up
    // and where the result lands.
    expect(r.wake_instructions).not.toMatch(
      /\bBash\b|\bMonitor\b|run_in_background|tail|ScheduleWakeup|end your turn/i,
    );
    tools.shutdown();
  });

  it("file write failure does not block the notification fallback", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "finished" }));
    const notifications: WatchEvent[] = [];
    // Point the fire dir at a path we can't write to so the file emit throws.
    const tools = new WatchTools(
      fake.engine,
      (event) => notifications.push(event),
      {
        // /dev/null is a character device, any sub-path → ENOTDIR on mkdir.
        fireDir: "/dev/null/cant-write",
        registry: fastRegistry,
      },
    );
    tools.watch({ expr: "return s", matcher: { equals: "finished" } });
    await wait(60);
    // The MCP notification still went through even when the file write failed.
    expect(notifications).toHaveLength(1);
    tools.shutdown();
  });

  it("notification failure does not block the file write", async () => {
    const fake = makeFakeEngine();
    fake.setExecuteHandler(() => ({ value: "finished" }));
    const failNotify = vi.fn(() => {
      throw new Error("transport down");
    });
    const tools = new WatchTools(fake.engine, failNotify, {
      fireDir,
      registry: fastRegistry,
    });
    const res = tools.watch({
      expr: "return s",
      matcher: { equals: "finished" },
    });
    await wait(60);
    expect(failNotify).toHaveBeenCalled();
    expect(existsSync(res.fire_path)).toBe(true);
    tools.shutdown();
  });
});
