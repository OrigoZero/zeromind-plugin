import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { unlinkSync } from "node:fs";
import { fetch } from "undici";
import { issuer } from "./zeromind-client.js";
import { remoteUrl } from "./server-spec.js";
import { installSecret, loadCache } from "./config.js";
import { openWithPlatform } from "./cli-open.js";
import { credentialLock, readState, saveState, statePath } from "./cli-state.js";

type Metadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
};
type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};
type Login = {
  issuer: string;
  resource: string;
  client_id: string;
  metadata: Metadata;
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
};
const FILE = "cli-oauth.json";

/** OAuth endpoints use HTTPS, with HTTP available for loopback development. */
export function checkedEndpoint(value: string): string {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.hash ||
    (u.protocol !== "https:" &&
      !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
  ) {
    throw new Error("OAuth endpoint must use HTTPS or HTTP loopback");
  }
  return u.href;
}

async function jsonRequest<T>(url: string, init: Parameters<typeof fetch>[1] = {}): Promise<T> {
  const response = await fetch(checkedEndpoint(url), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `OAuth request failed (${response.status}); run zero login --force if authorization expired.`,
    );
  }
  return (await response.json()) as T;
}

function tokenForm(endpoint: string, fields: Record<string, string>): Promise<Tokens> {
  return jsonRequest(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function withTokens(login: Omit<Login, "access_token" | "expires_at">, tokens: Tokens): Login {
  if (
    !tokens.access_token ||
    tokens.token_type?.toLowerCase() !== "bearer" ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0
  )
    throw new Error("OAuth server returned invalid token metadata");
  return {
    ...login,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? login.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? login.scope,
  };
}

async function refreshLogin(stored: Login): Promise<Login> {
  if (!stored.refresh_token) throw new Error("Sign-in expired; run zero login.");
  const tokens = await tokenForm(stored.metadata.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
    client_id: stored.client_id,
    resource: stored.resource,
  });
  const updated = withTokens(stored, tokens);
  saveState(FILE, updated);
  return updated;
}

export async function login(
  options: {
    open?: (url: string) => Promise<void>;
    out?: (line: string) => void;
    timeoutMs?: number;
    force?: boolean;
    scope?: string;
  } = {},
): Promise<void> {
  await credentialLock(async () => {
    const base = issuer();
    const out = options.out ?? ((s: string) => process.stderr.write(s + "\n"));
    const previous = readState<Login>(FILE);
    if (
      !options.force &&
      !options.scope &&
      previous?.issuer === base &&
      previous.expires_at <= Date.now() + 60_000 &&
      previous.refresh_token
    ) {
      await refreshLogin(previous);
      out("Signed in. Existing authorization refreshed.");
      return;
    }
    if (
      !options.force &&
      !options.scope &&
      previous?.issuer === base &&
      previous.expires_at > Date.now() + 60_000
    ) {
      out("Already signed in. Use zero login --force to authorize again.");
      return;
    }
    const resource = remoteUrl(base);
    const protectedResource = await jsonRequest<{
      resource: string;
      authorization_servers: string[];
    }>(`${base}/.well-known/oauth-protected-resource/mcp`);
    if (
      protectedResource.resource !== resource ||
      !protectedResource.authorization_servers?.length
    ) {
      throw new Error("OAuth resource discovery does not identify this MCP endpoint");
    }
    const authIssuer = checkedEndpoint(protectedResource.authorization_servers[0]).replace(
      /\/+$/,
      "",
    );
    const metadata = await jsonRequest<Metadata>(
      `${authIssuer}/.well-known/oauth-authorization-server`,
    );
    if (
      metadata.issuer.replace(/\/+$/, "") !== authIssuer ||
      !metadata.code_challenge_methods_supported?.includes("S256")
    ) {
      throw new Error("OAuth discovery must identify this issuer and support PKCE S256");
    }
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
    ])
      checkedEndpoint(endpoint);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    let complete!: (code: string) => void;
    let fail!: (error: Error) => void;
    const received = new Promise<string>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    // A timeout or browser refusal can occur while registration is in flight.
    void received.catch(() => {});
    const server = createServer((request, response) => {
      const u = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      if (u.pathname !== "/callback" || u.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid authorization callback.");
        return;
      }
      const code = u.searchParams.get("code");
      if (u.searchParams.has("error") || !code) {
        response.writeHead(400).end("Authorization was declined. Return to your terminal.");
        fail(new Error("Authorization was declined; run zero login to try again."));
        return;
      }
      response.end("Authorization received. Return to your terminal.");
      complete(code);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not start OAuth callback listener");
    const redirect = `http://127.0.0.1:${address.port}/callback`;
    const timer = setTimeout(
      () => fail(new Error("Authorization timed out; run zero login again.")),
      options.timeoutMs ?? 600_000,
    );
    const interrupted = () => fail(new Error("Authorization cancelled."));
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    try {
      const registered = await jsonRequest<{ client_id: string }>(metadata.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Zero CLI",
          redirect_uris: [redirect],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (!registered.client_id) throw new Error("OAuth registration returned no client id");
      const url = new URL(metadata.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: registered.client_id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        state,
        resource,
        scope: options.scope ?? "read write",
      }).toString();
      out(`Authorize Zero CLI in your browser:\n${url.href}`);
      try {
        await (options.open ?? openWithPlatform)(url.href);
      } catch {
        out("Open the authorization URL above in a browser on this machine.");
      }
      const code = await received;
      const tokens = await tokenForm(metadata.token_endpoint, {
        grant_type: "authorization_code",
        client_id: registered.client_id,
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
        resource,
      });
      saveState(
        FILE,
        withTokens({ issuer: base, resource, client_id: registered.client_id, metadata }, tokens),
      );
      out("Signed in. Your CLI commands can now use the hosted ZeroMind connection.");
    } finally {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

/** Reuse an OAuth grant, rotating it under a process-wide credential lock. */
export async function cliBearer(): Promise<string> {
  return credentialLock(async () => {
    const stored = readState<Login>(FILE);
    if (stored?.issuer === issuer()) {
      if (stored.expires_at > Date.now() + 60_000) return stored.access_token;
      const updated = await refreshLogin(stored);
      return updated.access_token;
    }
    const linked = installSecret(loadCache());
    if (linked) return linked;
    throw new Error("Sign in once with zero login, or link an agent account with zeromind link.");
  });
}

export async function logout(): Promise<void> {
  await credentialLock(async () => {
    const stored = readState<Login>(FILE);
    if (!stored) return;
    if (stored.issuer !== issuer())
      throw new Error("Select the issuer this CLI signed in against before logging out.");
    if (!stored.metadata.revocation_endpoint)
      throw new Error("The OAuth issuer does not advertise revocation.");
    for (const token of [stored.refresh_token, stored.access_token].filter(
      (v): v is string => !!v,
    )) {
      const response = await fetch(checkedEndpoint(stored.metadata.revocation_endpoint), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, client_id: stored.client_id }).toString(),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(
          `OAuth revocation failed (${response.status}); credentials retained for retry.`,
        );
    }
    unlinkSync(statePath(FILE));
  });
}
