import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issuer } from "../src/zeromind-client.js";
import { updateCache } from "../src/config.js";

describe("zeromind-client: issuer resolution", () => {
  beforeEach(() => {
    process.env.ZEROMIND_CONFIG_DIR = mkdtempSync(join(tmpdir(), "zm-issuer-"));
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
  });

  it("falls back to the cache's issuer when the env is unset", () => {
    delete process.env.ZEROMIND_ISSUER;
    updateCache({ issuer: "https://zm.local/" });
    expect(issuer()).toBe("https://zm.local");
  });

  it("prefers the env over the cache's issuer", () => {
    updateCache({ issuer: "https://zm.local/" });
    process.env.ZEROMIND_ISSUER = "https://override.example/";
    expect(issuer()).toBe("https://override.example");
  });
});
