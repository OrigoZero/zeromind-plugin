import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { linkMachine, writeClaudeEnv } from "../src/cli-link.js";
import { loadCache, updateCache } from "../src/config.js";
import { runLinkCli } from "../src/cli-link.js";

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

  it("says who an already-linked machine acts as, and asks for no new code", async () => {
    const mock: MockServerHandle = await startMockServer();
    process.env.ZEROMIND_ISSUER = mock.url;
    // The machine this cache describes was linked once — by an earlier run, or
    // by the engine, which writes the same file.
    const registered = (await (
      await fetch(`${mock.url}/v1/installs/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install_name: "zero-engine", public_key: "pk" }),
      })
    ).json()) as { install_id: string; install_secret: string };
    mock.forceApprove(registered.install_id, "usr_already", false, { username: "brick-bot" });
    updateCache({ ...registered, user_id: "usr_already" });

    const lines: string[] = [];
    const cache = await linkMachine({ out: (l) => lines.push(l), wait: async () => {} });

    expect(lines.join("\n")).toBe("Already linked: this machine acts as @brick-bot.");
    expect(mock.state.linkCodeRequests).toBe(0);
    expect(cache.install_secret).toBe(registered.install_secret);
    // Only a handle ZeroMind actually named carries an `@`.
    expect(lines.join("\n")).toContain("@brick-bot");
    expect(loadCache()?.user_id).toBe("usr_already");
    await mock.stop();
  });

  it("still hands the secret to Claude Code when the machine was already linked", async () => {
    const mock: MockServerHandle = await startMockServer();
    process.env.ZEROMIND_ISSUER = mock.url;
    const home = mkdtempSync(join(tmpdir(), "zm-home-"));
    mkdirSync(join(home, ".claude"));
    const previousHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    updateCache({ install_id: "inst_engine", install_secret: "ins_sec_engine", user_id: "usr_engine" });
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      await runLinkCli(["link"]);
    } finally {
      write.mockRestore();
      process.env.HOME = previousHome.HOME;
      process.env.USERPROFILE = previousHome.USERPROFILE;
    }
    const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(settings.env.ZEROMIND_INSTALL_SECRET).toBe("ins_sec_engine");
    expect(printed.join("")).toContain("Already linked");
    expect(mock.state.linkCodeRequests).toBe(0);
    await mock.stop();
  });

  it("still reports the link when ZeroMind cannot be reached, without a handle", async () => {
    process.env.ZEROMIND_ISSUER = "http://127.0.0.1:9";
    updateCache({ install_id: "inst_off", install_secret: "ins_sec_off", user_id: "usr_off" });
    const lines: string[] = [];
    await linkMachine({ out: (l) => lines.push(l), wait: async () => {} });
    expect(lines.join("\n")).toBe("Already linked: this machine acts as your bot.");
  });

  it("asks for a code when the install was registered but never approved", async () => {
    const mock: MockServerHandle = await startMockServer({ approveAfterPolls: 1 });
    process.env.ZEROMIND_ISSUER = mock.url;
    const registered = (await (
      await fetch(`${mock.url}/v1/installs/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install_name: "zero-engine", public_key: "pk" }),
      })
    ).json()) as { install_id: string; install_secret: string };
    // A secret with no user_id is a registration nobody approved.
    updateCache(registered);

    const lines: string[] = [];
    await linkMachine({ out: (l) => lines.push(l), wait: async () => {} });

    expect(mock.state.linkCodeRequests).toBe(1);
    expect(lines.join("\n")).toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
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
