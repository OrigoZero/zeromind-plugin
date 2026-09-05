import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** The machine's link, in the shape the Zero engine reads and writes at the same path. */
export type SessionCache = {
  session_token?: string;
  issuer?: string;
  install_id?: string;
  install_secret?: string;
  install_private_key?: string;
  install_name?: string;
  user_id?: string;
};

export const cacheDir = (): string => {
  if (process.env.ZEROMIND_CONFIG_DIR) return process.env.ZEROMIND_CONFIG_DIR;
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appdata, "zero");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "zero");
};

export const cachePath = (): string => join(cacheDir(), "session.json");

export const loadCache = (): SessionCache | undefined => {
  const p = cachePath();
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as SessionCache;
};

const writeCache = (next: SessionCache): SessionCache => {
  const p = cachePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") chmodSync(p, 0o600);
  return next;
};

export const updateCache = (patch: Partial<SessionCache>): SessionCache =>
  writeCache({ ...(loadCache() ?? {}), ...patch });

export const deleteCache = (): void => {
  const p = cachePath();
  if (existsSync(p)) rmSync(p);
};

/** The fields the machine's link owns. The rest of the cache — the engine's
 *  own session and the issuer it signed in against — is not this CLI's to
 *  throw away. */
const INSTALL_FIELDS = [
  "install_id",
  "install_secret",
  "install_private_key",
  "install_name",
  "user_id",
] as const;

/**
 * Remove the machine's link from the cache and leave everything else in it.
 * A `session_token` that is the install secret under another name is that
 * same credential and goes with it; a file left holding nothing is deleted.
 */
export const clearInstall = (): SessionCache | undefined => {
  const cache = loadCache();
  if (!cache) return undefined;
  const secret = installSecret(cache);
  const next: SessionCache = { ...cache };
  for (const field of INSTALL_FIELDS) delete next[field];
  if (next.session_token && next.session_token === secret) delete next.session_token;
  if (Object.keys(next).length === 0) {
    deleteCache();
    return undefined;
  }
  return writeCache(next);
};

/** The install secret: its own field, else a session token that has the install shape. */
export const installSecret = (c: SessionCache | undefined): string | undefined =>
  c?.install_secret ?? (c?.session_token?.startsWith("ins_sec_") ? c.session_token : undefined);
