import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { cliBearer, loginAgent, logoutAgent, verifyAgent } from "../src/cli-agent.js";

let server: MockServerHandle | undefined, dir: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await server.stop();
    server = undefined;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

it("approves a distinct agent, preserves parent credentials and reuses the agent on repeated login", async () => {
  server = await startMockServer({ port: 0 });
  dir = mkdtempSync(join(tmpdir(), "zero-cli-agent-"));
  vi.stubEnv("ZEROMIND_CONFIG_DIR", dir);
  vi.stubEnv("ZEROMIND_ISSUER", server.url);
  const parent = JSON.stringify({ session_token: "ses_parent", issuer: server.url });
  writeFileSync(join(dir, "session.json"), parent);
  writeFileSync(
    join(dir, "cli-oauth.json"),
    JSON.stringify({
      access_token: "parent-oauth",
      issuer: server.url,
      expires_at: Date.now() + 3600000,
    }),
  );
  await expect(cliBearer()).rejects.toThrow("agent identity");
  const output: string[] = [];
  await loginAgent({
    username: "cli-builder",
    out: (text) => output.push(text),
    open: async (address) => {
      expect(new URL(address).searchParams.get("user_code")).toBeTruthy();
      const install = [...server!.state.installs.values()].find((row) => row.pending_code);
      expect(install?.pending_suggested_username).toBe("cli-builder");
      server!.forceApprove(install!.install_id, "agent-builder", true, { username: "cli-builder" });
    },
    wait: async () => {},
  });
  const secret = await cliBearer();
  expect((await verifyAgent(secret)).id).toBe("agent-builder");
  await loginAgent({
    username: "an-earlier-suggestion",
    out: (text) => output.push(text),
    open: async () => {
      throw new Error("Approval must be reused");
    },
  });
  expect(server.state.linkCodeRequests).toBe(1);
  expect(readFileSync(join(dir, "session.json"), "utf8")).toBe(parent);
  server.state.profileFor("agent-builder").is_agent = false;
  await expect(cliBearer()).rejects.toThrow("parent-user credential");
  server.state.profileFor("agent-builder").is_agent = true;
  await logoutAgent();
  expect(existsSync(join(dir, "cli-agent.json"))).toBe(false);
  expect(readFileSync(join(dir, "session.json"), "utf8")).toBe(parent);
  expect(output.join("\n")).not.toContain(secret);
});
