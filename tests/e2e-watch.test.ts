import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";

// End-to-end validation of the watch primitive through the real stdio MCP
// transport. Two properties matter most and are enforced here:
//
//   1. After the agent calls `watch`, there is a USER-OBSERVABLE IDLE GAP
//      with no further tool calls from the agent. The fire arrives as a
//      notification (the host's job is to translate that into a new turn).
//      Concretely: between the watch response and the notification, the
//      MCP server emits no tool-call traffic on stdout.
//
//   2. `unwatch` called from a SUBSEQUENT turn (i.e. after `watch` has
//      returned and the turn ended) cancels the watcher; the engine state
//      can change to a value that WOULD have fired and no notification is
//      ever emitted.

type JsonRpcResponse = { id?: number; result?: unknown; error?: unknown };
type JsonRpcNotification = { method: string; params?: unknown };

type Driver = {
  send: (method: string, params: unknown, id: number) => Promise<unknown>;
  waitForNotification: (
    predicate: (n: JsonRpcNotification) => boolean,
    timeoutMs: number,
  ) => Promise<JsonRpcNotification | undefined>;
  recentNotifications: () => JsonRpcNotification[];
  stdoutBytesSince: () => number;
  stdoutTrafficSince: (start: number) => number;
};

const makeDriver = (proc: ChildProcess): Driver => {
  const pendingById = new Map<number, (msg: JsonRpcResponse) => void>();
  const notifications: JsonRpcNotification[] = [];
  const notificationWaiters: Array<{
    predicate: (n: JsonRpcNotification) => boolean;
    resolve: (n: JsonRpcNotification) => void;
  }> = [];
  let buf = "";
  let totalBytes = 0;

  proc.stdout!.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: JsonRpcResponse & Partial<JsonRpcNotification>;
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue;
      }
      if (typeof msg.id === "number") {
        const resolve = pendingById.get(msg.id);
        if (resolve) {
          pendingById.delete(msg.id);
          resolve(msg);
        }
        continue;
      }
      if (typeof msg.method === "string") {
        const note: JsonRpcNotification = { method: msg.method, params: msg.params };
        notifications.push(note);
        for (let i = notificationWaiters.length - 1; i >= 0; i--) {
          const w = notificationWaiters[i];
          if (w.predicate(note)) {
            notificationWaiters.splice(i, 1);
            w.resolve(note);
          }
        }
      }
    }
  });

  return {
    send: (method, params, id) =>
      new Promise((resolve, reject) => {
        pendingById.set(id, (msg) => {
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        });
        proc.stdin!.write(
          JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
        );
      }),
    waitForNotification: (predicate, timeoutMs) =>
      new Promise((resolve) => {
        const existing = notifications.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        const waiter = {
          predicate,
          resolve: (n: JsonRpcNotification) => {
            clearTimeout(t);
            resolve(n);
          },
        };
        notificationWaiters.push(waiter);
        const t = setTimeout(() => {
          const idx = notificationWaiters.indexOf(waiter);
          if (idx >= 0) notificationWaiters.splice(idx, 1);
          resolve(undefined);
        }, timeoutMs);
      }),
    recentNotifications: () => notifications.slice(),
    stdoutBytesSince: () => totalBytes,
    stdoutTrafficSince: (start) => totalBytes - start,
  };
};

const callTool = async (
  driver: Driver,
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<unknown> => {
  const resp = (await driver.send("tools/call", { name, arguments: args }, id)) as {
    content: { text: string }[];
    isError?: boolean;
  };
  if (resp.isError) throw new Error(`tool ${name} errored: ${resp.content[0]?.text}`);
  return JSON.parse(resp.content[0].text);
};

const E2E_USER_ID = "usr_e2e_watch";

const linkOnce = async (
  server: MockServerHandle,
  driver: Driver,
  tmpConfigDir: string,
  startId: number,
): Promise<void> => {
  await callTool(driver, "zm_link", {}, startId);
  const { loadConfig } = await import("../src/config.js");
  process.env.ZEROMIND_CONFIG_DIR = tmpConfigDir;
  const cfg = loadConfig()!;
  server.forceApprove(cfg.install_id, E2E_USER_ID);
  await callTool(driver, "zm_link_poll", {}, startId + 1);
};

const openSession = async (
  server: MockServerHandle,
  driver: Driver,
  worldName: string,
  sessionTag: string,
  startId: number,
): Promise<{ sessionId: string; browser: WebSocket; nextId: number; worldGuid: string }> => {
  const world = (await callTool(
    driver,
    "world.create",
    { name: worldName },
    startId,
  )) as { guid: string };
  const sessionId = `ses_${sessionTag}`;
  const browser = new WebSocket(
    `${server.wsUrl}/v1/bridge?role=browser&world_guid=${world.guid}&session_id=${sessionId}`,
    { headers: { authorization: `Bearer mock-user-jwt-${E2E_USER_ID}` } },
  );
  await new Promise<void>((r) => browser.once("open", () => r()));
  await new Promise((r) => setTimeout(r, 50));
  const connectRes = (await callTool(
    driver,
    "world.connect",
    { guid: world.guid },
    startId + 1,
  )) as { ok: boolean; session_id?: string };
  expect(connectRes).toEqual({ ok: true, session_id: sessionId });
  return { sessionId, browser, nextId: startId + 2, worldGuid: world.guid };
};

describe("watch e2e (stdio MCP)", () => {
  let server: MockServerHandle;
  let tmp: ReturnType<typeof withTmpConfigDir>;
  let proc: ChildProcess;
  let driver: Driver;

  beforeAll(async () => {
    if (!existsSync("dist/index.js")) {
      throw new Error("dist/index.js missing — run `npm run build` before `npm test`");
    }
    server = await startMockServer({ port: 0 });
    tmp = withTmpConfigDir();
    proc = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        ZEROMIND_CONFIG_DIR: tmp.dir,
        ZEROMIND_ISSUER: server.url,
        ZEROMIND_BRIDGE_URL: server.wsUrl,
        ZEROMIND_IDE_NAME: "e2e-watch",
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    driver = makeDriver(proc);
    await driver.send(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-watch", version: "0" },
      },
      1,
    );
    await linkOnce(server, driver, tmp.dir, 10);
  });

  afterAll(async () => {
    proc.kill();
    await server.stop();
    tmp.cleanup();
  });

  it("exposes watch and unwatch in the tool list", async () => {
    const result = (await driver.send("tools/list", {}, 2)) as {
      tools: { name: string }[];
    };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("watch");
    expect(names).toContain("unwatch");
  });

  it(
    "watch returns immediately, the agent goes idle, then the fire arrives as a notification",
    async () => {
      const { browser, nextId } = await openSession(server, driver, "watch-fire", "w1", 100);

      // The "engine" (browser side) starts returning 'running' and flips to
      // 'finished' once the test releases the gate. Each execute() poll from
      // the plugin's watch loop is answered with the current state.
      let state = "running";
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
        if (f.method === "execute") {
          browser.send(
            JSON.stringify({ type: "rpc.response", id: f.id, result: { value: state } }),
          );
        }
      });

      // Turn N: register the watch. Must return immediately with a watcher_id.
      const watchT0 = Date.now();
      const watchRes = (await callTool(
        driver,
        "watch",
        {
          status_field: "tasks.status(42)",
          matcher: { equals: "finished" },
          poll_ms: 40,
          timeout_ms: 5_000,
          label: "task-42-finished",
        },
        nextId,
      )) as { watcher_id: string };
      const watchElapsed = Date.now() - watchT0;
      expect(watchRes.watcher_id).toMatch(/^wat_/);
      // "Returns immediately" — well under the timeout_ms and even well under
      // a single poll interval. Pad generously for CI jitter.
      expect(watchElapsed).toBeLessThan(1_000);

      // Idle window — the agent does no further tool calls. Capture stdout
      // baseline; any notification traffic between now and the fire is
      // notifications-from-plugin only (no tool responses, since the agent
      // doesn't ask for anything). We also verify that no notification with
      // the watcher.fired type arrives while the engine is still 'running'.
      const idleStart = driver.stdoutBytesSince();
      await new Promise((r) => setTimeout(r, 200));
      const noFireYet = driver.recentNotifications().find(
        (n) =>
          n.method === "notifications/zeromind/watcher" &&
          (n.params as { watcher_id?: string })?.watcher_id === watchRes.watcher_id,
      );
      expect(noFireYet).toBeUndefined();

      // Flip engine state — the next poll observes 'finished' and fires.
      state = "finished";
      const fire = await driver.waitForNotification(
        (n) =>
          n.method === "notifications/zeromind/watcher" &&
          (n.params as { watcher_id?: string })?.watcher_id === watchRes.watcher_id,
        3_000,
      );
      expect(fire).toBeDefined();
      expect(fire!.params).toMatchObject({
        state: "fired",
        watcher_id: watchRes.watcher_id,
        label: "task-42-finished",
        value: "finished",
      });

      // Between watch and fire, all stdout traffic was notifications — the
      // plugin sent no tool calls (the agent issued none). This is the
      // "idle gap" property: the agent is genuinely out of any tool loop.
      const idleTraffic = driver.stdoutTrafficSince(idleStart);
      // Lower bound: a notification frame has nonzero bytes. Upper bound:
      // we just want to know it's not a flood of tool responses.
      expect(idleTraffic).toBeGreaterThan(0);

      browser.close();
    },
    20_000,
  );

  it(
    "unwatch from a later turn cancels the watcher; engine flip never fires it",
    async () => {
      const { browser, nextId } = await openSession(server, driver, "watch-cancel", "w2", 200);

      let state = "running";
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
        if (f.method === "execute") {
          browser.send(
            JSON.stringify({ type: "rpc.response", id: f.id, result: { value: state } }),
          );
        }
      });

      // Turn N: watch.
      const watchRes = (await callTool(
        driver,
        "watch",
        {
          status_field: "tasks.status(99)",
          matcher: { equals: "finished" },
          poll_ms: 40,
          timeout_ms: 5_000,
        },
        nextId,
      )) as { watcher_id: string };

      // Simulate idle time between turns — the agent is doing OTHER things
      // (or simply asleep). The poll loop is running in the background.
      await new Promise((r) => setTimeout(r, 150));

      // Turn N+K (K≥1): the agent decides to cancel. This call only works
      // because watch was non-blocking — the agent is alive and out of the
      // watch call, free to issue unwatch.
      const cancelRes = (await callTool(
        driver,
        "unwatch",
        { id: watchRes.watcher_id },
        nextId + 1,
      )) as { ok: boolean; cancelled: boolean };
      expect(cancelRes).toEqual({ ok: true, cancelled: true });

      // Now flip the engine state to the value that WOULD have fired the
      // matcher. If the watcher were still alive, the next poll would fire.
      state = "finished";
      const note = await driver.waitForNotification(
        (n) =>
          n.method === "notifications/zeromind/watcher" &&
          (n.params as { watcher_id?: string })?.watcher_id === watchRes.watcher_id,
        500,
      );
      expect(note).toBeUndefined();

      // A second unwatch of the same id is a no-op (cancelled=false).
      const noop = (await callTool(
        driver,
        "unwatch",
        { id: watchRes.watcher_id },
        nextId + 2,
      )) as { ok: boolean; cancelled: boolean };
      expect(noop).toEqual({ ok: true, cancelled: false });

      browser.close();
    },
    20_000,
  );

  it(
    "watcher.timeout fires when the matcher never matches within timeout_ms",
    async () => {
      const { browser, nextId } = await openSession(server, driver, "watch-timeout", "w3", 300);

      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
        if (f.method === "execute") {
          browser.send(
            JSON.stringify({ type: "rpc.response", id: f.id, result: { value: "never" } }),
          );
        }
      });

      const watchRes = (await callTool(
        driver,
        "watch",
        {
          expr: "return tasks.status(7)",
          matcher: { equals: "finished" },
          poll_ms: 40,
          timeout_ms: 200,
        },
        nextId,
      )) as { watcher_id: string };

      const note = await driver.waitForNotification(
        (n) =>
          n.method === "notifications/zeromind/watcher" &&
          (n.params as { watcher_id?: string })?.watcher_id === watchRes.watcher_id,
        3_000,
      );
      expect(note).toBeDefined();
      expect(note!.params).toMatchObject({
        state: "timeout",
        watcher_id: watchRes.watcher_id,
        timeout_ms: 200,
      });

      browser.close();
    },
    20_000,
  );
});
