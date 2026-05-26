import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { startDeviceCode, pollLinkStatus, unlink } from "../src/link.js";

describe("link", () => {
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

  it("startDeviceCode returns user_code + verification_url", async () => {
    const cfg = await ensureRegistered({ ideName: "test" });
    const code = await startDeviceCode(cfg);
    expect(code.user_code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(code.verification_url).toBe("http://localhost/link");
    expect(code.interval).toBeGreaterThan(0);
  });

  it("pollLinkStatus returns pending then approved", async () => {
    const cfg = await ensureRegistered({ ideName: "test" });
    await startDeviceCode(cfg);
    let status = await pollLinkStatus(cfg);
    expect(status.status).toBe("pending");

    server.forceApprove(cfg.install_id, "usr_test");
    status = await pollLinkStatus(cfg);
    expect(status.status).toBe("approved");
    if (status.status === "approved") expect(status.user_id).toBe("usr_test");
  });

  it("unlink severs the link and deletes the config", async () => {
    const cfg = await ensureRegistered({ ideName: "test" });
    server.forceApprove(cfg.install_id, "usr_test");
    await unlink(cfg);
    const { loadConfig } = await import("../src/config.js");
    expect(loadConfig()).toBeUndefined();
    expect(server.state.installs.get(cfg.install_id)?.linked).toBe(false);
  });
});
