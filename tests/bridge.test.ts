import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { Bridge } from "../src/bridge.js";

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

describe("bridge client", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("connects when install is linked", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_t");
      const b = new Bridge(cfg);
      await b.connect();
      expect(b.isConnected()).toBe(true);
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("call() forwards to a target session and returns the result", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_b");

      const sessionId = "ses_echo";
      const worldGuid = "wld_b";
      const browser = new WebSocket(
        `${server.wsUrl}/v1/bridge?role=browser&world_guid=${worldGuid}&session_id=${sessionId}`,
        { headers: { authorization: "Bearer mock-user-jwt-usr_b" } },
      );
      await new Promise<void>((r) => browser.once("open", () => r()));
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as {
          type: string;
          id?: string;
          method?: string;
          params?: { value?: number };
        };
        if (f.type === "rpc.call" && f.method === "execute") {
          browser.send(
            JSON.stringify({
              type: "rpc.response",
              id: f.id,
              result: { value: (f.params?.value ?? 0) + 1 },
            }),
          );
        }
      });

      const b = new Bridge(cfg);
      await b.connect();
      const r = await b.call({
        target_session: sessionId,
        method: "execute",
        params: { value: 41 },
      });
      expect(r).toEqual({ value: 42 });
      await b.close();
      browser.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("call() rejects with the rpc.error code when the server forbids it", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_b2");
      const b = new Bridge(cfg);
      await b.connect();
      await expect(
        b.call({ target_session: "ses_does_not_exist", method: "execute" }),
      ).rejects.toMatchObject({ mcpCode: "forbidden" });
      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("tracks session.opened / session.closed events", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const cfg = await ensureRegistered({ ideName: "t" });
      server.forceApprove(cfg.install_id, "usr_s");
      const b = new Bridge(cfg);
      await b.connect();

      const opened: string[] = [];
      const closed: string[] = [];
      b.on("session.opened", (e) => opened.push(e.session_id));
      b.on("session.closed", (e) => closed.push(e.session_id));

      const ws = new WebSocket(
        `${server.wsUrl}/v1/bridge?role=browser&world_guid=wld_s&session_id=ses_x`,
        { headers: { authorization: "Bearer mock-user-jwt-usr_s" } },
      );
      await new Promise<void>((r) => ws.once("open", () => r()));
      await new Promise((r) => setTimeout(r, 100));
      expect(opened).toContain("ses_x");
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(closed).toContain("ses_x");

      await b.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });
});
