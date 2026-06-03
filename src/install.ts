import { generateKeyPairSync } from "node:crypto";
import { loadConfig, saveConfig, type InstallConfig } from "./config.js";
import { registerInstall } from "./zeromind-client.js";

export const ensureRegistered = async (opts: { ideName: string }): Promise<InstallConfig> => {
  const existing = loadConfig();
  if (existing) return existing;

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

  // The install_name labels this IDE install in the user's Settings AND
  // seeds the default username/display_name of a freshly-minted agent
  // account at /link approval. It must NOT embed the machine hostname (or
  // any other user/host-identifying data): the linked account is the
  // AGENT's identity, not the machine's. The agent picks its own username
  // on the /link page and personalises its display name + bio afterwards
  // via `zeromind.profile`. Keep this a neutral IDE label only.
  const installName = opts.ideName;
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
