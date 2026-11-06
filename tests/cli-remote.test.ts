import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell, shellCode } from "../src/cli-remote.js";

const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("hosted CLI", () => {
  it("preserves caller identity and branch selection across processes while isolating agents", async () => {
    const config = mkdtempSync(join(tmpdir(), "zero-cli-test-"));
    directories.push(config);
    const seen: Array<{
      method: string;
      params: { _meta: { threadId: string }; arguments: Record<string, unknown> };
    }> = [];
    const pins = new Map<string, unknown>();
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      seen.push(request);
      res.setHeader("content-type", "application/json");
      if (request.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      if (request.method === "initialize") {
        res.setHeader("Mcp-Session-Id", "transport");
        res.end(JSON.stringify({ id: request.id, result: {} }));
        return;
      }
      const caller = request.params._meta.threadId;
      if (request.params.name === "session.connect") pins.set(caller, request.params.arguments);
      let value: unknown = pins.get(caller) ?? { unbound: true };
      if (request.params.name === "execute")
        value = { result: JSON.stringify({ stdout: "a\n", stderr: "warning\n", exitCode: 7 }) };
      res.end(
        JSON.stringify({
          id: request.id,
          result: { content: [{ type: "text", text: JSON.stringify(value) }] },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    writeFileSync(
      join(config, "session.json"),
      JSON.stringify({ install_secret: "test", issuer: `http://127.0.0.1:${port}` }),
    );
    const run = (context: string, ...args: string[]) =>
      new Promise<{ out: string; err: string; code: number | null }>((resolve, reject) => {
        const child = spawn(process.execPath, ["dist/index.js", "--context", context, ...args], {
          env: {
            ...process.env,
            ZEROMIND_CONFIG_DIR: config,
            ZEROMIND_ISSUER: `http://127.0.0.1:${port}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "",
          err = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (err += c));
        child.on("error", reject);
        child.on("close", (code) => resolve({ out, err, code }));
      });
    expect((await run("one", "connect", "--world", "world", "--branch", "feature")).code).toBe(0);
    expect((await run("one", "sessions")).out).toContain("feature");
    expect((await run("two", "sessions")).out).toContain("unbound");
    expect(await run("one", "bash", "-c", "printf a; exit 7")).toEqual({
      out: "a\n",
      err: "warning\n",
      code: 7,
    });
    const calls = seen.filter((r) => r.method === "tools/call");
    expect(calls[0].params._meta.threadId).toBe(calls[1].params._meta.threadId);
    expect(calls[0].params._meta.threadId).not.toBe(calls[2].params._meta.threadId);
    expect(calls[0].params.arguments).toEqual({ world: "world", branch: "feature" });
  });

  it("waits for promoted shell work and preserves its failure status", async () => {
    const calls: string[] = [];
    let output = "",
      errors = "";
    const code = await runShell(
      {
        callTool: async (name) => {
          calls.push(name);
          return {
            isError: false,
            text: JSON.stringify(
              name === "execute"
                ? { status: "running", taskId: "task:42" }
                : { result: { stdout: "done", stderr: "failed", exitCode: 23 } },
            ),
          };
        },
      },
      "slow",
      (s) => (output += s),
      (s) => (errors += s),
    );
    expect(calls).toEqual(["execute", "wait"]);
    expect(code).toBe(23);
    expect(output).toBe("done");
    expect(errors).toBe("failed");
  });

  it("passes command text through a collision-free Luau literal", () => {
    const command = "\nprintf 'λ\\n'; echo ]=]; echo ]==]";
    expect(shellCode(command)).toBe(`return task.await(shell.runAsync([===[\n${command}]===]))`);
  });

  it("reports a missing shell result instead of claiming success", async () => {
    await expect(
      runShell({ callTool: async () => ({ text: "{}", isError: false }) }, "echo hi"),
    ).rejects.toThrow("no shell result");
  });
});
