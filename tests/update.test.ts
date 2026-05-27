import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { compareVersions, checkForUpdate, resetUpdateCache, VERSION } from "../src/update.js";

describe("compareVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.0", "0.5.0")).toBe(0);
    expect(compareVersions("0.4.9", "0.5.0")).toBeLessThan(0);
    expect(compareVersions("0.5.1", "0.5.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("ignores pre-release suffixes and missing components", () => {
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("checkForUpdate", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });
  beforeEach(() => {
    process.env.ZEROMIND_NPM_REGISTRY = server.url;
    resetUpdateCache();
  });
  afterEach(() => {
    delete process.env.ZEROMIND_NPM_REGISTRY;
    resetUpdateCache();
  });

  it("reports the running version and resolves no-update against an older registry version", async () => {
    const info = await checkForUpdate();
    expect(info.current).toBe(VERSION);
    expect(info.latest).toBe("0.0.1"); // mock registry advertises an old version
    expect(info.update_available).toBe(false);
    expect(info.how_to_update).toBeUndefined();
  });

  it("is best-effort: an unreachable registry never throws", async () => {
    process.env.ZEROMIND_NPM_REGISTRY = "http://127.0.0.1:1"; // nothing listening
    resetUpdateCache();
    const info = await checkForUpdate();
    expect(info.current).toBe(VERSION);
    expect(info.update_available).toBe(false);
  });

  it("memoizes within a process (single-flight)", async () => {
    const a = await checkForUpdate();
    const b = await checkForUpdate();
    expect(a).toBe(b);
  });
});
