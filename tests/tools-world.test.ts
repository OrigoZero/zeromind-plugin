import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { Bridge } from "../src/bridge.js";
import { WorldTools } from "../src/tools/world.js";

const setEnv = (server: MockServerHandle, dir: string): void => {
  process.env.ZEROMIND_CONFIG_DIR = dir;
  process.env.ZEROMIND_ISSUER = server.url;
  process.env.ZEROMIND_BRIDGE_URL = server.wsUrl;
};
const clearEnv = (): void => {
  delete process.env.ZEROMIND_CONFIG_DIR;
  delete process.env.ZEROMIND_ISSUER;
  delete process.env.ZEROMIND_BRIDGE_URL;
};

describe("world tools", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("list + create works against the mock server", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_w");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      const w = await tools.create({ name: "test" });
      expect(w.name).toBe("test");
      const list = await tools.list();
      expect(list.find((x) => x.guid === w.guid)).toBeDefined();
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("fork creates a new world owned by the caller, inheriting visibility", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_fork");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      // Seed a source world to fork (its guid is what search returns).
      const src = await tools.create({ name: "src-world", public: true });

      const forked = await tools.fork({ source: src.guid, name: "my-fork" });
      if ("error" in forked) throw new Error(`fork errored: ${forked.error}`);
      expect(forked.world_guid).toBeDefined();
      expect(forked.world_guid).not.toBe(src.guid);
      expect(forked.bootstrapped).toBe(false);
      expect(forked.source_guid).toBe(src.guid);

      // The fork shows up in the caller's own world list.
      const list = await tools.list();
      expect(list.find((x) => x.guid === forked.world_guid)).toBeDefined();
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("delete → trash → restore round-trips", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_del");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      const w = await tools.create({ name: "doomed" });
      // Soft-delete by name → leaves the active list, lands in trash.
      const del = await tools.delete({ name: "doomed" });
      expect("guid" in del && del.guid).toBe(w.guid);
      const list = await tools.list();
      expect(list.find((x) => x.guid === w.guid)).toBeUndefined();

      const trash = await tools.trash();
      expect(trash.retention_days).toBeGreaterThan(0);
      const trashed = trash.worlds.find((x) => x.guid === w.guid);
      expect(trashed).toBeDefined();
      expect(trashed!.purges_in_days).toBeGreaterThan(0);

      // Restore by name resolves against the trash list (not world.list).
      const restored = await tools.restore({ name: "doomed" });
      expect("guid" in restored && restored.guid).toBe(w.guid);
      const list2 = await tools.list();
      expect(list2.find((x) => x.guid === w.guid)).toBeDefined();
      expect((await tools.trash()).worlds.find((x) => x.guid === w.guid)).toBeUndefined();

      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("re-delete is idempotent (keeps original deleted_at)", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_del2");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      const w = await tools.create({ name: "twice" });
      const first = await tools.delete({ guid: w.guid });
      const second = await tools.delete({ guid: w.guid });
      const at1 = "deleted_at" in first ? first.deleted_at : undefined;
      const at2 = "deleted_at" in second ? second.deleted_at : undefined;
      expect(at1).toBeDefined();
      expect(at2).toBe(at1);

      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("connect with no active session returns no_active_session + url", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_w2");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      const result = await tools.connect({
        guid: "wld_nonexistent",
        timeout_ms: 200,
      });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toBe("no_active_session");
        expect(result.url).toContain("/edit/wld_nonexistent");
        expect(result.message.toLowerCase()).toContain("ask the user to open");
      }
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("connect long-polls and resolves when a browser session opens mid-wait", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_poll");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);
      const world = await tools.create({ name: "poll" });

      let lateWs: WebSocket | undefined;
      const timer = setTimeout(() => {
        lateWs = new WebSocket(
          `${server.wsUrl}/v1/bridge?role=browser&world_guid=${world.guid}&session_id=ses_late`,
          { headers: { authorization: "Bearer mock-user-jwt-usr_poll" } },
        );
      }, 100);

      try {
        const result = await tools.connect({
          guid: world.guid,
          timeout_ms: 5_000,
        });
        expect(result).toEqual({ ok: true, session_id: "ses_late" });
        expect(tools.currentSession()).toBe("ses_late");
      } finally {
        clearTimeout(timer);
        if (lateWs) lateWs.close();
      }

      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("connect succeeds once a browser session opens for the world", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_w3");
      const b = new Bridge(cfg);
      await b.connect();
      const tools = new WorldTools(cfg, b);

      const world = await tools.create({ name: "play" });
      const ws = new WebSocket(
        `${server.wsUrl}/v1/bridge?role=browser&world_guid=${world.guid}&session_id=ses_p`,
        { headers: { authorization: "Bearer mock-user-jwt-usr_w3" } },
      );
      await new Promise<void>((r) => ws.once("open", () => r()));
      await new Promise((r) => setTimeout(r, 100));

      const result = await tools.connect({ guid: world.guid });
      expect(result).toEqual({ ok: true, session_id: "ses_p" });
      expect(tools.currentSession()).toBe("ses_p");

      ws.close();
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });
});
