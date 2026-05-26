import { generateKeyPairSync } from "node:crypto";
import { hostname } from "node:os";
import { loadConfig, saveConfig, type InstallConfig } from "./config.js";
import { registerInstall } from "./zeromind-client.js";

export const ensureRegistered = async (opts: { ideName: string }): Promise<InstallConfig> => {
  const existing = loadConfig();
  if (existing) return existing;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  const installName = `${opts.ideName} @ ${hostname()}`;
  const { install_id, install_secret } = await registerInstall({
    install_name: installName,
    public_key: pubPem,
  });

  const cfg: InstallConfig = {
    install_id,
    install_secret,
    private_key: privPem,
    install_name: installName,
    created_at: new Date().toISOString(),
  };
  saveConfig(cfg);
  return cfg;
};
