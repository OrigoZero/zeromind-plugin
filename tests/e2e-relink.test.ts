import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";

// Regression for OrigoZero/ZeroMind#130: after an unlink + re-link inside a
// single MCP-server process, the world/engine/content clients were memoized
// from the FIRST install's credential and never rebuilt — so every
// authenticated REST call kept presenting the old (now-unlinked) secret and
// the backend rejected it with 401, even though `auth_status` (which re-reads
// install.json every call) reported the install as linked. The fix tears the
// memoized clients down on every credential-changing transition (zm_link,
// zm_unlink, zm_link_poll→approved) so the next tool call rebuilds them
// against the freshly-written install.json.

type RpcResult = { result?: unknown; error?: unknown };
type ToolResult = { content: { text: string }[]; isError?: boolean };

const sendRpc = (
  proc: ChildProcess,
  method: string,
  params: unknown,
  id: number,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number } & RpcResult;
          if (msg.id === id) {
            proc.stdout!.off("data", onData);
            if (msg.error) reject(msg.error);
            else resolve(msg.result);
            return;
          }
        } catch {
          // partial line — keep buffering
        }
      }
    };
    proc.stdout!.on("data", onData);
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

const call = (proc: ChildProcess, name: string, args: unknown, id: number): Promise<ToolResult> =>
  sendRpc(proc, "tools/call", { name, arguments: args }, id) as Promise<ToolResult>;

describe("e2e re-link credential refresh (ZeroMind#130)", () => {
  let server: MockServerHandle;
  let tmp: ReturnType<typeof withTmpConfigDir>;
  let proc: ChildProcess;

  beforeAll(async () => {
    if (!existsSync("dist/index.js")) {
      throw new Error("dist/index.js missing — run `npm run build` before `npm test`");
    }
    server = await startMockServer({ port: 0 });
    tmp = withTmpConfigDir();
    proc = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        ZEROMIND_CONFIG_DIR: tmp.dir,
        ZEROMIND_ISSUER: server.url,
        ZEROMIND_BRIDGE_URL: server.wsUrl,
        ZEROMIND_IDE_NAME: "e2e-relink",
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    await sendRpc(
      proc,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-relink", version: "0" },
      },
      1,
    );
    // Read install.json the spawned process writes (same tmp dir).
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
  });

  afterAll(async () => {
    proc.kill();
    await server.stop();
    tmp.cleanup();
  });

  const linkFreshAccount = async (
    userId: string,
    username: string,
    baseId: number,
  ): Promise<string> => {
    const { loadConfig } = await import("../src/config.js");
    const linkResp = await call(proc, "zm_link", {}, baseId);
    const link = JSON.parse(linkResp.content[0].text) as { status: string };
    expect(link.status).toBe("pending");
    const cfg = loadConfig()!;
    server.forceApprove(cfg.install_id, userId, true, { username });
    const pollResp = await call(proc, "zm_link_poll", {}, baseId + 1);
    const poll = JSON.parse(pollResp.content[0].text) as { status: string; user_id?: string };
    expect(poll.status).toBe("approved");
    expect(poll.user_id).toBe(userId);
    return cfg.install_id;
  };

  it("authenticated REST works against the new credential after unlink + re-link", async () => {
    // ── First link: install #1 ────────────────────────────────────────────
    const install1 = await linkFreshAccount("usr_one", "agent-one", 10);

    // Use world.create — this is what MEMOIZES the world client with
    // install #1's secret. Before the fix, that captured secret is what every
    // later REST call kept sending.
    const create1 = await call(proc, "world.create", { name: "world-one" }, 12);
    expect(create1.isError ?? false).toBe(false);
    const w1 = JSON.parse(create1.content[0].text) as { guid: string };
    expect(w1.guid).toMatch(/^wld_/);

    // ── Unlink ────────────────────────────────────────────────────────────
    const unlinkResp = await call(proc, "zm_unlink", {}, 13);
    expect(JSON.parse(unlinkResp.content[0].text)).toEqual({ ok: true });

    // ── Second link: install #2 (fresh secret, different account) ──────────
    const install2 = await linkFreshAccount("usr_two", "agent-two", 14);
    expect(install2).not.toBe(install1);

    // auth_status reports the NEW account as linked (it re-reads the config).
    const statusResp = await call(proc, "auth_status", {}, 16);
    const status = JSON.parse(statusResp.content[0].text) as {
      linked: boolean;
      user_id?: string;
      install_id: string;
    };
    expect(status.linked).toBe(true);
    expect(status.user_id).toBe("usr_two");
    expect(status.install_id).toBe(install2);

    // The regression: world.create must now succeed against install #2's
    // credential, not 401 against install #1's stale (now-unlinked) secret.
    const create2 = await call(proc, "world.create", { name: "world-two" }, 17);
    expect(create2.isError ?? false, `world.create after re-link returned: ${create2.content[0].text}`).toBe(false);
    const w2 = JSON.parse(create2.content[0].text) as { guid: string };
    expect(w2.guid).toMatch(/^wld_/);

    // world.list must reflect the NEW account's worlds (owned by usr_two),
    // proving the list client also rebuilt against the new credential.
    const listResp = await call(proc, "world.list", {}, 18);
    expect(listResp.isError ?? false, `world.list after re-link returned: ${listResp.content[0].text}`).toBe(false);
    const worlds = JSON.parse(listResp.content[0].text) as { name: string }[];
    expect(worlds.map((w) => w.name)).toEqual(["world-two"]);
  });
});
