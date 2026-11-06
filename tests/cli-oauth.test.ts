import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login, cliBearer, logout, checkedEndpoint } from "../src/cli-oauth.js";
import { saveState } from "../src/cli-state.js";

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  if (directory) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

it("authorizes with PKCE, ignores a wrong-state callback, rotates once for concurrent callers, and revokes", async () => {
  directory = mkdtempSync(join(tmpdir(), "zero-oauth-test-"));
  vi.stubEnv("ZEROMIND_CONFIG_DIR", directory);
  let base = "",
    challenge = "",
    refreshes = 0;
  const revoked: string[] = [];
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/oauth-protected-resource/mcp") {
      res.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base] }));
      return;
    }
    if (req.url === "/.well-known/oauth-authorization-server") {
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          registration_endpoint: `${base}/register`,
          token_endpoint: `${base}/token`,
          revocation_endpoint: `${base}/revoke`,
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }
    if (req.url === "/register") {
      res.end(JSON.stringify({ client_id: "client" }));
      return;
    }
    const fields = new URLSearchParams(body);
    if (req.url === "/token") {
      if (fields.get("grant_type") === "authorization_code") {
        if (
          createHash("sha256").update(fields.get("code_verifier")!).digest("base64url") !==
          challenge
        ) {
          res.writeHead(400).end("{}");
          return;
        }
      } else {
        refreshes++;
        if (fields.get("refresh_token") !== "refresh1") {
          res.writeHead(400).end("{}");
          return;
        }
      }
      res.end(
        JSON.stringify({
          access_token: refreshes ? "access2" : "access1",
          refresh_token: refreshes ? "refresh2" : "refresh1",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      return;
    }
    if (req.url === "/revoke") {
      revoked.push(fields.get("token")!);
      res.end("{}");
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv("ZEROMIND_ISSUER", base);
  const output: string[] = [];
  await login({
    out: (s) => output.push(s),
    open: async (address) => {
      const u = new URL(address);
      challenge = u.searchParams.get("code_challenge")!;
      const callback = new URL(u.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({ code: "code", state: "wrong" }).toString();
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set("state", u.searchParams.get("state")!);
      expect((await fetch(callback)).status).toBe(200);
    },
  });
  expect(await cliBearer()).toBe("access1");
  const stored = JSON.parse(readFileSync(join(directory, "cli-oauth.json"), "utf8"));
  saveState("cli-oauth.json", { ...stored, expires_at: 0 });
  expect(await Promise.all([cliBearer(), cliBearer()])).toEqual(["access2", "access2"]);
  expect(refreshes).toBe(1);
  await logout();
  expect(revoked).toEqual(["refresh2", "access2"]);
  expect(output.join("\n")).not.toContain("access1");
  expect(output.join("\n")).not.toContain("refresh1");
});

it("refuses insecure non-loopback OAuth endpoints", () => {
  expect(() => checkedEndpoint("http://localhost.evil.example/token")).toThrow();
  expect(() => checkedEndpoint("https://user:password@example.com/token")).toThrow();
  expect(checkedEndpoint("http://127.0.0.1:123/token")).toContain("127.0.0.1");
});
