import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { linkMachine, writeClaudeEnv } from "../src/cli-link.js";
import { loadCache } from "../src/config.js";

describe("zeromind link", () => {
  beforeEach(() => {
    process.env.ZEROMIND_CONFIG_DIR = mkdtempSync(join(tmpdir(), "zm-link-"));
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
  });

  it("registers, shows the code, polls to approval, and records the bot", async () => {
    const mock: MockServerHandle = await startMockServer({ approveAfterPolls: 2 });
    process.env.ZEROMIND_ISSUER = mock.url;
    const lines: string[] = [];
    const cache = await linkMachine({ out: (s) => lines.push(s), wait: async () => {} });
    expect(lines.join("\n")).toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
    expect(lines.join("\n")).toContain("/link");
    expect(cache.install_secret?.startsWith("ins_sec_")).toBe(true);
    expect(loadCache()?.user_id).toBeTruthy();
    await mock.stop();
  });

  it("writes the secret into a Claude Code settings env block without touching other keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "zm-claude-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ permissions: { allow: ["Bash"] }, env: { OTHER: "1" } }));
    expect(writeClaudeEnv("ins_sec_z", p)).toBe("updated");
    const json = JSON.parse(readFileSync(p, "utf8"));
    expect(json.env).toEqual({ OTHER: "1", ZEROMIND_INSTALL_SECRET: "ins_sec_z" });
    expect(json.permissions.allow).toEqual(["Bash"]);
    expect(writeClaudeEnv("ins_sec_z", p)).toBe("exists");
  });

  it("creates a settings file (and its parent directory) that doesn't exist yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "zm-claude-new-"));
    const p = join(dir, "nested", "settings.json");
    expect(existsSync(dirname(p))).toBe(false);
    expect(writeClaudeEnv("ins_sec_new", p)).toBe("written");
    expect(existsSync(dirname(p))).toBe(true);
    const json = JSON.parse(readFileSync(p, "utf8"));
    expect(json).toEqual({ env: { ZEROMIND_INSTALL_SECRET: "ins_sec_new" } });
  });

  it("adds an env block to a settings file that has none, preserving its other keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "zm-claude-noenv-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, JSON.stringify({ permissions: { allow: ["Bash"] } }));
    expect(writeClaudeEnv("ins_sec_q", p)).toBe("updated");
    const json = JSON.parse(readFileSync(p, "utf8"));
    expect(json).toEqual({
      permissions: { allow: ["Bash"] },
      env: { ZEROMIND_INSTALL_SECRET: "ins_sec_q" },
    });
  });

  it("throws a clear error on unparsable JSON and leaves the file untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "zm-claude-bad-"));
    const p = join(dir, "settings.json");
    writeFileSync(p, "{ not json");
    expect(() => writeClaudeEnv("ins_sec_x", p)).toThrow(
      `${p} is not valid JSON; fix or move it, then run zeromind link again`,
    );
    expect(readFileSync(p, "utf8")).toBe("{ not json");
  });
});
