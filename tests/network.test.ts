import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch } from "undici";
import { certificateAuthorities, newDispatcher, proxyConfigured } from "../src/network.js";
import { describeRendererCheckFailure, launchableEngine } from "../src/engine-launch.js";

let dir: string;
const saved: Record<string, string | undefined> = {};
const VARS = ["ZEROMIND_CONFIG_DIR", "ZEROMIND_ISSUER", "ZERO_ENGINE_DIR", "ZERO_ENGINE_BIN"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zero-network-"));
  for (const name of VARS) saved[name] = process.env[name];
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in target, and a stand-in proxy that records each CONNECT and tunnels it. */
async function startProxy(): Promise<{ servers: Server[]; url: string; target: string; seen: string[] }> {
  const seen: string[] = [];
  const target = createServer((req, res) => res.end(`target saw ${req.url}`));
  const proxy = createServer((_req, res) => res.end("plain request"));
  proxy.on("connect", (req, client, head) => {
    seen.push(req.url ?? "");
    const [host, port] = (req.url ?? "").split(":");
    const upstream = connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  for (const server of [target, proxy])
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server: Server) => (server.address() as { port: number }).port;
  return {
    servers: [target, proxy],
    url: `http://127.0.0.1:${port(proxy)}`,
    target: `127.0.0.1:${port(target)}`,
    seen,
  };
}

it("sends a request through the proxy the environment names, and past it for NO_PROXY", async () => {
  const proxy = await startProxy();
  try {
    for (let round = 0; round < 2; round++) {
      const env = { HTTP_PROXY: proxy.url, NO_PROXY: "localhost" };
      expect(proxyConfigured(env)).toBe(true);
      const answer = await fetch(`http://${proxy.target}/path-${round}`, {
        dispatcher: newDispatcher(env),
        signal: AbortSignal.timeout(10000),
      });
      expect(await answer.text()).toBe(`target saw /path-${round}`);
      expect(proxy.seen.at(-1)).toBe(proxy.target);
      const before = proxy.seen.length;
      await expect(
        // A loopback port nothing listens on: reached directly, it refuses.
        fetch("http://localhost:9/", { dispatcher: newDispatcher(env), signal: AbortSignal.timeout(10000) }),
      ).rejects.toThrow();
      expect(proxy.seen.length).toBe(before);
    }
    expect(proxyConfigured({})).toBe(false);
  } finally {
    for (const server of proxy.servers) server.close();
  }
});

it("adds a named certificate bundle to the built-in authorities and keeps verification", () => {
  const bundle = join(dir, "proxy-ca.pem");
  writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\nproxy\n-----END CERTIFICATE-----\n");
  expect(certificateAuthorities({})).toBeUndefined();
  const authorities = certificateAuthorities({ SSL_CERT_FILE: bundle })!;
  expect(authorities.length).toBe(rootCertificates.length + 1);
  expect(authorities.at(-1)).toContain("proxy");
});

it("launches the installed engine, naming why, when the release feed cannot be read", async () => {
  process.env.ZEROMIND_CONFIG_DIR = join(dir, "config");
  process.env.ZERO_ENGINE_DIR = join(dir, "engines");
  delete process.env.ZERO_ENGINE_BIN;
  // A loopback port nothing listens on.
  process.env.ZEROMIND_ISSUER = "http://127.0.0.1:9";
  mkdirSync(process.env.ZERO_ENGINE_DIR, { recursive: true });
  writeFileSync(
    join(process.env.ZERO_ENGINE_DIR, "current.json"),
    JSON.stringify({ binary: process.execPath, version: "0.0.1", platform: "test", sha256: "00" }),
  );
  for (let round = 0; round < 2; round++) {
    const lines: string[] = [];
    expect(await launchableEngine(undefined, (line) => lines.push(line))).toBe(process.execPath);
    expect(lines.join("\n")).toMatch(/Could not check for a newer engine \(.+\); launching the installed 0\.0\.1\./);
  }
});

it("names the glibc an engine needs when the loader refuses it", () => {
  const message = describeRendererCheckFailure(
    "native: /lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.43' not found (required by native)",
  );
  expect(message).toContain("it needs glibc 2.43 or newer");
  expect(describeRendererCheckFailure("adapter refused")).toContain("Headless renderer check failed: adapter refused");
});
