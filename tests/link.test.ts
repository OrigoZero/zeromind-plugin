import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { startDeviceCode, pollLinkStatus, unlink } from "../src/link.js";
import { loadCache, updateCache } from "../src/config.js";

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

  it("unlink severs the link and leaves a cache holding only the install empty", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    server.forceApprove(cache.install_id!, "usr_test");
    expect(await unlink(cache)).toBe("revoked");
    // Nothing was in this cache but the install and its own mirror, so the
    // file goes with it.
    expect(loadCache()).toBeUndefined();
    expect(server.state.installs.get(cache.install_id!)?.linked).toBe(false);
  });

  it("unlink clears the install fields and keeps the engine's session", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    server.forceApprove(cache.install_id!, "usr_test");
    // The engine signed in on this machine: its session and issuer live in
    // the same file and are not this command's to throw away.
    updateCache({ session_token: "ses_operator", user_id: "usr_test", issuer: server.url });

    expect(await unlink({ ...cache, install_secret: cache.install_secret })).toBe("revoked");

    const after = loadCache();
    expect(after).toEqual({ session_token: "ses_operator", issuer: server.url });
  });

  it("a revoke ZeroMind answers 401 still clears the machine", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    server.forceApprove(cache.install_id!, "usr_test");
    updateCache({ session_token: "ses_operator" });
    server.state.unlinkStatus = 401;
    try {
      // 401 means ZeroMind holds no such install — the machine must not be
      // left holding a credential nothing accepts.
      expect(await unlink({ ...cache, install_secret: cache.install_secret })).toBe(
        "already-revoked",
      );
    } finally {
      server.state.unlinkStatus = undefined;
    }
    expect(loadCache()).toEqual({ session_token: "ses_operator" });
  });

  it("a revoke that fails for any other reason leaves the cache untouched", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    server.forceApprove(cache.install_id!, "usr_test");
    const before = loadCache();
    server.state.unlinkStatus = 503;
    try {
      await expect(unlink({ ...cache, install_secret: cache.install_secret })).rejects.toThrow(
        /ZeroMind answered 503; this machine's link is untouched — run `zeromind unlink` again/,
      );
    } finally {
      server.state.unlinkStatus = undefined;
    }
    expect(loadCache()).toEqual(before);
  });

  it("a revoke that cannot be sent at all leaves the cache untouched", async () => {
    const cache = await ensureRegistered({ installName: "zero-engine" });
    const before = loadCache();
    process.env.ZEROMIND_ISSUER = "http://127.0.0.1:9";
    await expect(unlink({ ...cache, install_secret: cache.install_secret })).rejects.toThrow(
      /could not reach ZeroMind .*; this machine's link is untouched/,
    );
    expect(loadCache()).toEqual(before);
  });
});
