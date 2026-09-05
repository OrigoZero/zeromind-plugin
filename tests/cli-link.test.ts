import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
