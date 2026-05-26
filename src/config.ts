import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type InstallConfig = {
  install_id: string;
  install_secret: string;
  private_key: string;
  install_name: string;
  created_at: string;
};

const defaultDir = (): string => {
  if (process.env.ZEROMIND_CONFIG_DIR) return process.env.ZEROMIND_CONFIG_DIR;
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appdata, "zeromind");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "zeromind");
};

export const configPath = (): string => join(defaultDir(), "install.json");

export const loadConfig = (): InstallConfig | undefined => {
  const p = configPath();
  if (!existsSync(p)) return undefined;
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as InstallConfig;
};

export const saveConfig = (cfg: InstallConfig): void => {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") chmodSync(p, 0o600);
};

export const deleteConfig = (): void => {
  const p = configPath();
  if (existsSync(p)) rmSync(p);
};
