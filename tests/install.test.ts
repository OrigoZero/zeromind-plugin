import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { hostname } from "node:os";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { loadCache, updateCache } from "../src/config.js";

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

  it("registers once and keeps an operator session token that is already there", async () => {
    updateCache({ session_token: "ses_human" });
    const first = await ensureRegistered({ installName: "zero-engine" });
    expect(first.install_secret?.startsWith("ins_sec_")).toBe(true);
    expect(loadCache()?.session_token).toBe("ses_human");
    const second = await ensureRegistered({ installName: "zero-engine" });
    expect(second.install_id).toBe(first.install_id);
  });

  it("seeds the session token with the install secret when the cache holds none", async () => {
    const c = await ensureRegistered({ installName: "zero-engine" });
    expect(loadCache()?.session_token).toBe(c.install_secret);
  });

  it("uses a machine-neutral install_name (no hostname leak)", async () => {
    const cfg = await ensureRegistered({ installName: "test-ide" });
    // The install_name seeds the default agent username/display at /link
    // approval, so it must not embed the machine hostname or any other
    // host/user-identifying data — only the neutral label the caller passed.
    expect(cfg.install_name).toBe("test-ide");
    expect(cfg.install_name).not.toContain("@");
    expect(cfg.install_name).not.toContain(hostname());
  });
});
