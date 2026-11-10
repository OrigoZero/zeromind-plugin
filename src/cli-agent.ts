import { generateKeyPairSync } from "node:crypto";
import { unlinkSync } from "node:fs";
import { installSecret, loadCache, type SessionCache } from "./config.js";
import { credentialLock, readState, saveState, statePath } from "./cli-state.js";
import {
  issuer,
  registerInstall,
  createLinkCode,
  getLinkStatus,
  postUnlink,
} from "./zeromind-client.js";
import { openWithPlatform } from "./cli-open.js";
import { checkedEndpoint } from "./cli-oauth.js";

const FILE = "cli-agent.json";
type AgentCache = SessionCache & { issuer: string; username?: string };
type Agent = { id: string; username: string; is_agent: boolean };

export async function verifyAgent(secret: string, base = issuer()): Promise<Agent> {
  const response = await fetch(`${base}/v1/me`, {
    headers: { authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `Agent authorization was refused (${response.status}); run zero login to approve an agent account.`,
    );
  const result = (await response.json()) as { user?: Agent };
  if (result.user?.is_agent !== true || !result.user.id || !result.user.username) {
    throw new Error(
      "CLI commands require an agent identity. A parent-user credential cannot be used; run zero login to approve an agent account.",
    );
  }
  return result.user;
}

/** A CLI-specific installation is approved through the existing agent-account link flow. */
export async function loginAgent(
  options: {
    username?: string;
    noBrowser?: boolean;
    open?: (url: string) => Promise<void>;
    out?: (line: string) => void;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  await credentialLock(async () => {
    const base = issuer();
    let cache = readState<AgentCache>(FILE);
    if (cache && cache.issuer !== base)
      throw new Error(
        "Select this CLI agent's issuer or a separate ZEROMIND_CONFIG_DIR before signing in to another service.",
      );
    const out = options.out ?? ((line) => process.stderr.write(line + "\n"));
    if (!cache) {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const registration = await registerInstall({
        install_name: "zero-cli",
        public_key: publicKey.export({ format: "pem", type: "spki" }).toString(),
      });
      cache = {
        ...registration,
        issuer: base,
        install_name: "zero-cli",
        install_private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      };
      saveState(FILE, cache);
    }
    const credentials = { install_id: cache.install_id!, install_secret: cache.install_secret! };
    const status = await getLinkStatus(credentials);
    if (status.status === "approved") {
      const agent = await verifyAgent(credentials.install_secret, base);
      saveState(FILE, { ...cache, user_id: agent.id, username: agent.username });
      out(`Signed in as agent @${agent.username}.`);
      return;
    }
    const code = await createLinkCode(credentials, options.username);
    const url = new URL(checkedEndpoint(code.verification_url));
    url.searchParams.set("user_code", code.user_code);
    out(`Approve this CLI's agent identity:\n${url.href}`);
    if (!options.noBrowser) {
      try {
        await (options.open ?? openWithPlatform)(url.href);
      } catch {
        out("Open the approval URL in your browser. The CLI will wait here.");
      }
    }
    const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + code.expires_in * 1000;
    while (Date.now() < deadline) {
      const linked = await getLinkStatus(credentials);
      if (linked.status === "approved") {
        const agent = await verifyAgent(credentials.install_secret, base);
        if (agent.id !== linked.user_id)
          throw new Error("The approved agent and authenticated identity differ");
        saveState(FILE, { ...cache, user_id: agent.id, username: agent.username });
        out(`Signed in as agent @${agent.username}.`);
        return;
      }
      if (linked.status !== "pending") throw new Error("Agent approval was declined or expired");
      await wait(Math.max(1, code.interval) * 1000);
    }
    throw new Error("Agent approval expired; run zero login again for a fresh link.");
  });
}

export async function cliBearer(): Promise<string> {
  const own = readState<AgentCache>(FILE);
  let secret: string | undefined;
  if (own) {
    if (own.issuer !== issuer()) throw new Error("This CLI agent is linked to a different issuer");
    secret = installSecret(own);
  } else secret = installSecret(loadCache());
  if (!secret)
    throw new Error(
      "Run zero login to approve an agent identity (use --no-browser on a remote computer).",
    );
  await verifyAgent(secret);
  return secret;
}

export async function logoutAgent(): Promise<void> {
  await credentialLock(async () => {
    const cache = readState<AgentCache>(FILE);
    if (!cache) return;
    if (cache.issuer !== issuer()) throw new Error("Select this agent's issuer before logging out");
    const status = await postUnlink({
      install_id: cache.install_id!,
      install_secret: cache.install_secret!,
    });
    if (status >= 300 && ![401, 403, 404].includes(status))
      throw new Error(`Agent revocation failed (${status}); credential retained for retry`);
    unlinkSync(statePath(FILE));
  });
}
