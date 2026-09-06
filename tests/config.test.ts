import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachePath, loadCache, updateCache, deleteCache, installSecret } from "../src/config.js";

describe("config: the engine's session cache", () => {
  beforeEach(() => {
    process.env.ZEROMIND_CONFIG_DIR = mkdtempSync(join(tmpdir(), "zm-cache-"));
  });

  it("lives at <dir>/session.json", () => {
    expect(cachePath()).toBe(join(process.env.ZEROMIND_CONFIG_DIR!, "session.json"));
    delete process.env.ZEROMIND_CONFIG_DIR;
    const p = cachePath();
    expect(p.endsWith(join("zero", "session.json"))).toBe(true);
  });

  it("merges a patch over what is there and writes the engine's keys", () => {
    updateCache({ session_token: "ses_human", issuer: "https://origozero.ai" });
    updateCache({ install_id: "inst_1", install_secret: "ins_sec_a", install_private_key: "k", install_name: "zero-engine" });
    const raw = JSON.parse(readFileSync(cachePath(), "utf8"));
    expect(raw).toEqual({
      session_token: "ses_human", issuer: "https://origozero.ai", install_id: "inst_1",
      install_secret: "ins_sec_a", install_private_key: "k", install_name: "zero-engine",
    });
    expect(loadCache()?.session_token).toBe("ses_human");
  });

  it("reads the install secret from a cache written before the field existed", () => {
    expect(installSecret({ session_token: "ins_sec_old" })).toBe("ins_sec_old");
    expect(installSecret({ session_token: "ses_x" })).toBeUndefined();
    expect(installSecret({ session_token: "ses_x", install_secret: "ins_sec_n" })).toBe("ins_sec_n");
  });

  it("deletes the file", () => {
    updateCache({ issuer: "x" });
    deleteCache();
    expect(existsSync(cachePath())).toBe(false);
    expect(loadCache()).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("writes mode 0600 off Windows", () => {
    updateCache({ issuer: "x" });
    expect(statSync(cachePath()).mode & 0o777).toBe(0o600);
  });
});
