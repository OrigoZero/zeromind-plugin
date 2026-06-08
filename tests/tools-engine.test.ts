import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { Bridge } from "../src/bridge.js";
import { WorldTools } from "../src/tools/world.js";
import { EngineTools } from "../src/tools/engine.js";
import { createWorld } from "../src/zeromind-client.js";
import { uploadFile } from "../src/upload.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

const setupConnectedSession = async (server: MockServerHandle, userId: string) => {
  const cfg = await ensureRegistered({ ideName: "t" });
  server.forceApprove(cfg.install_id, userId);
  const b = new Bridge(cfg);
  await b.connect();
  const w = await createWorld(cfg, { name: "e" });
  const worldTools = new WorldTools(cfg, b);
  const sessionId = "ses_e";
  const browser = new WebSocket(
    `${server.wsUrl}/v1/bridge?role=browser&world_guid=${w.guid}&session_id=${sessionId}`,
    { headers: { authorization: `Bearer mock-user-jwt-${userId}` } },
  );
  await new Promise<void>((r) => browser.once("open", () => r()));
  await new Promise((r) => setTimeout(r, 100));
  await worldTools.connect({ guid: w.guid });
  return { cfg, b, worldTools, browser, sessionId };
};

describe("engine tools", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("execute forwards to the bridge and returns the result", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const { b, worldTools, browser } = await setupConnectedSession(server, "usr_e1");
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
        if (f.method === "execute") {
          browser.send(
            JSON.stringify({ type: "rpc.response", id: f.id, result: { value: 7 } }),
          );
        }
      });
      const engine = new EngineTools(b, worldTools);
      const r = await engine.execute({ code: "return 7" });
      expect(r).toEqual({ value: 7 });
      await b.close();
      browser.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("execute throws NotConnectedError when no session is active", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const { b, worldTools, browser } = await setupConnectedSession(server, "usr_e2");
      worldTools.disconnect();
      const engine = new EngineTools(b, worldTools);
      const { NotConnectedError } = await import("../src/errors.js");
      expect(() => engine.execute({ code: "x" })).toThrow(NotConnectedError);
      await b.close();
      browser.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("capture passes through", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    try {
      const { b, worldTools, browser } = await setupConnectedSession(server, "usr_e3");
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
        if (f.method === "capture") {
          // The real engine replies with an MCP image content block.
          browser.send(
            JSON.stringify({
              type: "rpc.response",
              id: f.id,
              result: { type: "image", mime_type: "image/png", data: "AAAA" },
            }),
          );
        }
      });
      const engine = new EngineTools(b, worldTools);
      const r = await engine.capture({});
      expect(r).toEqual({ type: "image", mime_type: "image/png", data: "AAAA" });
      await b.close();
      browser.close();
    } finally {
      clearEnv();
      tmp.cleanup();
    }
  });

  it("upload_file forwards a local binary file to engine write_file over the bridge", async () => {
    const tmp = withTmpConfigDir();
    setEnv(server, tmp.dir);
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "zm-up-e2e-"));
    try {
      const { b, worldTools, browser } = await setupConnectedSession(server, "usr_e4");
      // Non-UTF-8 bytes: proves the binary survives the round-trip intact.
      const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
      const src = path.join(srcDir, "model.glb");
      await fs.writeFile(src, payload);

      let received: { path?: string; content_b64?: string } | undefined;
      browser.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as {
          id?: string;
          method?: string;
          params?: { path?: string; content_b64?: string };
        };
        if (f.method === "write_file") {
          received = f.params;
          browser.send(JSON.stringify({ type: "rpc.response", id: f.id, result: { ok: true } }));
        }
      });

      const engine = new EngineTools(b, worldTools);
      const r = await uploadFile(engine, { local_path: src, vfs_path: "/source/model.glb" });
      expect(r.uploaded).toBe(1);
      expect(r.bytes).toBe(payload.length);
      expect(received?.path).toBe("/source/model.glb");
      expect(Buffer.from(received!.content_b64!, "base64").equals(payload)).toBe(true);

      await b.close();
      browser.close();
    } finally {
      clearEnv();
      tmp.cleanup();
      await fs.rm(srcDir, { recursive: true, force: true });
    }
  });
});
