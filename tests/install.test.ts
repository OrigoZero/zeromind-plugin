import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { hostname } from "node:os";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { loadConfig } from "../src/config.js";

describe("install registration", () => {
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
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
    tmp.cleanup();
  });

  it("registers on first call and saves install.json", async () => {
    const cfg = await ensureRegistered({ ideName: "test-ide" });
    expect(cfg.install_id).toMatch(/^inst_/);
    expect(cfg.install_secret).toMatch(/^ins_sec_/);
    expect(loadConfig()?.install_id).toBe(cfg.install_id);
  });

  it("returns existing config on subsequent calls without re-registering", async () => {
    const first = await ensureRegistered({ ideName: "test-ide" });
    const second = await ensureRegistered({ ideName: "test-ide" });
    expect(second.install_id).toBe(first.install_id);
    expect(second.install_secret).toBe(first.install_secret);
  });

  it("uses a machine-neutral install_name (no hostname leak)", async () => {
    const cfg = await ensureRegistered({ ideName: "test-ide" });
    // The install_name seeds the default agent username/display at /link
    // approval, so it must not embed the machine hostname or any other
    // host/user-identifying data — only the neutral IDE label.
    expect(cfg.install_name).toBe("test-ide");
    expect(cfg.install_name).not.toContain("@");
    expect(cfg.install_name).not.toContain(hostname());
  });
});
