import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { authStatus, zmLink, zmLinkPoll, zmUnlink } from "../src/tools/auth.js";
import { resetUpdateCache, VERSION } from "../src/update.js";

describe("auth tools", () => {
  let server: MockServerHandle;
  let tmp: ReturnType<typeof withTmpConfigDir>;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });
  beforeEach(() => {
    tmp = withTmpConfigDir();
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
    process.env.ZEROMIND_ISSUER = server.url;
    process.env.ZEROMIND_NPM_REGISTRY = server.url;
    resetUpdateCache();
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
    delete process.env.ZEROMIND_NPM_REGISTRY;
    tmp.cleanup();
  });

  it("authStatus reports unlinked for a fresh install + an update check", async () => {
    const s = await authStatus();
    expect(s.linked).toBe(false);
    expect(s.install_id).toMatch(/^inst_/);
    // The mock registry advertises an older version → no update.
    expect(s.update.update_available).toBe(false);
    expect(s.update.current).toBe(VERSION);
  });

  it("zmLink returns pending code on first call, approved after user approves", async () => {
    const first = await zmLink({ ideName: "t" });
    expect(first.status).toBe("pending");
    if (first.status === "pending") {
      expect(first.user_code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    }
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig();
    expect(cfg).toBeDefined();
    server.forceApprove(cfg!.install_id, "usr_a");
    const second = await zmLink({ ideName: "t" });
    expect(second.status).toBe("approved");
    if (second.status === "approved") expect(second.user_id).toBe("usr_a");
  });

  it("zmLinkPoll returns approved once user approves", async () => {
    await zmLink({ ideName: "t" });
    expect(await zmLinkPoll()).toEqual({ status: "pending" });
    const { loadConfig } = await import("../src/config.js");
    const cfg = loadConfig()!;
    server.forceApprove(cfg.install_id, "usr_p");
    expect(await zmLinkPoll()).toEqual({ status: "approved", user_id: "usr_p" });
  });

  it("zmUnlink deletes the config", async () => {
    await zmLink({ ideName: "t" });
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig()).toBeDefined();
    await zmUnlink();
    expect(loadConfig()).toBeUndefined();
  });
});
