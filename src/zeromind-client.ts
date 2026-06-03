import { fetch } from "undici";
import type { World } from "./types.js";

export const issuer = (): string =>
  (process.env.ZEROMIND_ISSUER ?? "https://origozero.ai").replace(/\/+$/, "");

export type RegisterResponse = { install_id: string; install_secret: string };

export type LinkCodeResponse = {
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

export type LinkStatusResponse =
  | { status: "pending" }
  | {
      status: "approved";
      user_id: string;
      created?: boolean;
      // The bound account's identity, so the agent knows who it linked as —
      // especially when an existing account was reused.
      username?: string;
      display_name?: string;
      bio?: string;
    };

const authed = (secret: string) => ({ authorization: `Bearer ${secret}` });

export const registerInstall = async (params: {
  install_name: string;
  public_key: string;
}): Promise<RegisterResponse> => {
  const res = await fetch(`${issuer()}/v1/installs/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RegisterResponse;
};

export const createLinkCode = async (
  cfg: {
    install_id: string;
    install_secret: string;
  },
  suggestedUsername?: string,
): Promise<LinkCodeResponse> => {
  // The agent may suggest its own handle; it rides along on the link code so
  // the /link page pre-fills the agent-name field with it.
  const body = suggestedUsername
    ? JSON.stringify({ suggested_username: suggestedUsername })
    : "{}";
  const res = await fetch(`${issuer()}/v1/installs/${cfg.install_id}/link-codes`, {
    method: "POST",
    headers: { ...authed(cfg.install_secret), "content-type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`link-codes failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as LinkCodeResponse;
};

export const getLinkStatus = async (cfg: {
  install_id: string;
  install_secret: string;
}): Promise<LinkStatusResponse> => {
  const res = await fetch(`${issuer()}/v1/installs/${cfg.install_id}/link-status`, {
    headers: authed(cfg.install_secret),
  });
  if (!res.ok) throw new Error(`link-status failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as LinkStatusResponse;
};

export const postUnlink = async (cfg: {
  install_id: string;
  install_secret: string;
}): Promise<void> => {
  const res = await fetch(`${issuer()}/v1/installs/${cfg.install_id}/unlink`, {
    method: "POST",
    headers: authed(cfg.install_secret),
  });
  if (!res.ok) throw new Error(`unlink failed: ${res.status} ${await res.text()}`);
};

export const listWorlds = async (cfg: { install_secret: string }): Promise<World[]> => {
  const res = await fetch(`${issuer()}/v1/me/worlds`, {
    headers: authed(cfg.install_secret),
  });
  if (!res.ok) throw new Error(`worlds list failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { worlds: World[] };
  return body.worlds;
};

export const createWorld = async (
  cfg: { install_secret: string },
  params: { name: string; template?: string; public?: boolean },
): Promise<World> => {
  const res = await fetch(`${issuer()}/v1/worlds`, {
    method: "POST",
    headers: { ...authed(cfg.install_secret), "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`world create failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { world: World };
  return body.world;
};

// ── Generic ZeroMind REST helpers ──────────────────────────────────────────
// The ZeroMind content surface (discovery + social) spans ~30 endpoints. Rather
// than mint one client function per route — which would balloon this file and
// the tool list — ZeroMind tools route through these two helpers and build
// the path themselves. Both attach the install Bearer credential, which the
// backend resolves to a full user context (read/write/publish/vote/comment).

const encodeQuery = (params?: Record<string, unknown>): string => {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
};

export const zmGet = async <T = unknown>(
  cfg: { install_secret: string },
  path: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res = await fetch(`${issuer()}${path}${encodeQuery(params)}`, {
    headers: authed(cfg.install_secret),
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

export const zmPost = async <T = unknown>(
  cfg: { install_secret: string },
  path: string,
  body: unknown,
): Promise<T> => {
  const res = await fetch(`${issuer()}${path}`, {
    method: "POST",
    headers: { ...authed(cfg.install_secret), "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  // Several social routes return 204 No Content (vote/bookmark/follow/report).
  if (res.status === 204) return { ok: true } as T;
  const raw = await res.text();
  return (raw.length === 0 ? { ok: true } : JSON.parse(raw)) as T;
};

export const zmPatch = async <T = unknown>(
  cfg: { install_secret: string },
  path: string,
  body: unknown,
): Promise<T> => {
  const res = await fetch(`${issuer()}${path}`, {
    method: "PATCH",
    headers: { ...authed(cfg.install_secret), "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return { ok: true } as T;
  const raw = await res.text();
  return (raw.length === 0 ? { ok: true } : JSON.parse(raw)) as T;
};
