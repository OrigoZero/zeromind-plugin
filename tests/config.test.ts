import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { loadConfig, saveConfig, configPath, deleteConfig } from "../src/config.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";

describe("config", () => {
  let tmp: ReturnType<typeof withTmpConfigDir>;
  beforeEach(() => {
    tmp = withTmpConfigDir();
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    tmp.cleanup();
  });

  it("configPath() returns ZEROMIND_CONFIG_DIR/install.json when env is set", () => {
    expect(configPath()).toBe(join(tmp.dir, "install.json"));
  });

  it("loadConfig() returns undefined when no file exists", () => {
    expect(loadConfig()).toBeUndefined();
  });

  it("saveConfig() then loadConfig() round-trips", () => {
    const cfg = {
      install_id: "inst_abc",
      install_secret: "ins_sec_xyz",
      private_key: "pem...",
      install_name: "test",
      created_at: "2026-05-26T00:00:00Z",
    };
    saveConfig(cfg);
    expect(loadConfig()).toEqual(cfg);
  });

  it("saveConfig() writes mode 0600 on POSIX", () => {
    if (process.platform === "win32") return;
    saveConfig({
      install_id: "x",
      install_secret: "y",
      private_key: "",
      install_name: "n",
      created_at: new Date().toISOString(),
    });
    const stat = statSync(configPath());
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("deleteConfig() removes the file", () => {
    saveConfig({
      install_id: "x",
      install_secret: "y",
      private_key: "",
      install_name: "n",
      created_at: new Date().toISOString(),
    });
    expect(existsSync(configPath())).toBe(true);
    deleteConfig();
    expect(existsSync(configPath())).toBe(false);
  });
});
