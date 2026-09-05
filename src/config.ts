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

export const updateCache = (patch: Partial<SessionCache>): SessionCache => {
  const next: SessionCache = { ...(loadCache() ?? {}), ...patch };
  const p = cachePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") chmodSync(p, 0o600);
  return next;
};

export const deleteCache = (): void => {
  const p = cachePath();
  if (existsSync(p)) rmSync(p);
};

/** The install secret: its own field, else a session token that has the install shape. */
export const installSecret = (c: SessionCache | undefined): string | undefined =>
  c?.install_secret ?? (c?.session_token?.startsWith("ins_sec_") ? c.session_token : undefined);

// --- Task 2 removes these: compatibility shims for the pre-rewrite callers
// (src/install.ts, src/link.ts, src/index.ts, src/bridge.ts, src/tools/*)
// that still import the old install.json-shaped API. They exist only to
// keep the build compiling until those callers are rewritten onto
// SessionCache directly.

/** The old per-plugin install shape, superseding onto the engine's cache fields. */
export type InstallConfig = SessionCache & {
  install_id: string;
  install_secret: string;
  private_key: string;
  install_name: string;
  created_at: string;
};

export const configPath = cachePath;

export const loadConfig = (): InstallConfig | undefined => loadCache() as InstallConfig | undefined;

export const saveConfig = (cfg: InstallConfig): void => {
  updateCache(cfg);
};

export const deleteConfig = deleteCache;
