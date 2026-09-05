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
    const cache = await ensureRegistered({ installName: "zero-engine" });
    const code = await startDeviceCode(cache);
    expect(code.user_code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(code.verification_url).toBe("http://localhost/link");
    expect(code.interval).toBeGreaterThan(0);
  });

  it("pollLinkStatus returns pending then approved", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    await startDeviceCode(cache);
    let status = await pollLinkStatus(cache);
    expect(status.status).toBe("pending");

    server.forceApprove(cache.install_id!, "usr_test");
    status = await pollLinkStatus(cache);
    expect(status.status).toBe("approved");
    if (status.status === "approved") expect(status.user_id).toBe("usr_test");
  });

  it("unlink severs the link and deletes the cache", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    server.forceApprove(cache.install_id!, "usr_test");
    await unlink(cache);
    const { loadCache } = await import("../src/config.js");
    expect(loadCache()).toBeUndefined();
    expect(server.state.installs.get(cache.install_id!)?.linked).toBe(false);
  });
});
