import { generateKeyPairSync } from "node:crypto";
import { installSecret, loadCache, updateCache, type SessionCache } from "./config.js";
import { registerInstall } from "./zeromind-client.js";

/** The machine's one install: reused when the cache holds one, registered otherwise. */
export const ensureRegistered = async (opts: { installName: string }): Promise<SessionCache> => {
  const existing = loadCache();
  if (existing?.install_id && installSecret(existing)) {
    return { ...existing, install_secret: installSecret(existing) };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const { install_id, install_secret } = await registerInstall({
    install_name: opts.installName,
    public_key: pubPem,
  });
  const patch: Partial<SessionCache> = {
    install_id,
    install_secret,
    install_private_key: privPem,
    install_name: opts.installName,
  };
  if (!existing?.session_token) patch.session_token = install_secret;
  return updateCache(patch);
};
