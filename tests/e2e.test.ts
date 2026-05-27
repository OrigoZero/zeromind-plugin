import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";

type RpcResult = { result?: unknown; error?: unknown };

const sendRpc = (proc: ChildProcess, method: string, params: unknown, id: number): Promise<unknown> =>
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
          // partial — ignore
        }
      }
    };
    proc.stdout!.on("data", onData);
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

describe("e2e stdio MCP", () => {
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
        ZEROMIND_IDE_NAME: "e2e",
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    await sendRpc(
      proc,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0" },
      },
      1,
    );
  });

  afterAll(async () => {
    proc.kill();
    await server.stop();
    tmp.cleanup();
  });

  it("lists tools", async () => {
    const result = (await sendRpc(proc, "tools/list", {}, 2)) as {
      tools: { name: string }[];
    };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("auth_status");
    expect(names).toContain("execute");
    expect(names).toContain("world.create");
    expect(names).toContain("zm_link");
    expect(names).toContain("hivemind.search");
    expect(names).toContain("hivemind.inspect");
    expect(names).toContain("hivemind.pull");
    expect(names).toContain("hivemind.engage");
  });

  it("lists prompts", async () => {
    const result = (await sendRpc(proc, "prompts/list", {}, 3)) as {
      prompts: { name: string }[];
    };
    const names = result.prompts.map((p) => p.name);
    expect(names).toContain("getting-started");
    expect(names).toContain("find-before-build");
    expect(names).toContain("link-this-ide");
    expect(names).toContain("open-and-iterate");
    expect(names).toContain("file-engine-bug");
  });

  it("walks full link → create → connect → execute flow", async () => {
    const linkResp = (await sendRpc(
      proc,
      "tools/call",
      { name: "zm_link", arguments: {} },
      4,
    )) as { content: { text: string }[] };
    const linkResult = JSON.parse(linkResp.content[0].text) as {
      status: string;
      user_code?: string;
    };
    expect(linkResult.status).toBe("pending");

    const { loadConfig } = await import("../src/config.js");
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
    const cfg = loadConfig()!;
    server.forceApprove(cfg.install_id, "usr_e2e");

    const pollResp = (await sendRpc(
      proc,
      "tools/call",
      { name: "zm_link_poll", arguments: {} },
      5,
    )) as { content: { text: string }[] };
    expect(JSON.parse(pollResp.content[0].text)).toEqual({
      status: "approved",
      user_id: "usr_e2e",
    });

    const createResp = (await sendRpc(
      proc,
      "tools/call",
      { name: "world.create", arguments: { name: "e2e-world" } },
      6,
    )) as { content: { text: string }[] };
    const world = JSON.parse(createResp.content[0].text) as { guid: string };
    expect(world.guid).toMatch(/^wld_/);

    const browser = new WebSocket(
      `${server.wsUrl}/v1/bridge?role=browser&world_guid=${world.guid}&session_id=ses_e2e`,
      { headers: { authorization: "Bearer mock-user-jwt-usr_e2e" } },
    );
    await new Promise<void>((r) => browser.once("open", () => r()));
    browser.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as { id?: string; method?: string };
      if (f.method === "execute") {
        browser.send(
          JSON.stringify({ type: "rpc.response", id: f.id, result: { value: 99 } }),
        );
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    const connectResp = (await sendRpc(
      proc,
      "tools/call",
      { name: "world.connect", arguments: { guid: world.guid } },
      7,
    )) as { content: { text: string }[] };
    expect(JSON.parse(connectResp.content[0].text)).toEqual({
      ok: true,
      session_id: "ses_e2e",
    });

    const execResp = (await sendRpc(
      proc,
      "tools/call",
      { name: "execute", arguments: { code: "return 99" } },
      8,
    )) as { content: { text: string }[] };
    expect(JSON.parse(execResp.content[0].text)).toEqual({ value: 99 });

    browser.close();
  });
});
