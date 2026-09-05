import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ensureRegistered } from "./install.js";
import { pollLinkStatus, startDeviceCode, unlink } from "./link.js";
import { installSecret, loadCache, updateCache, type SessionCache } from "./config.js";
import { SECRET_ENV } from "./server-spec.js";

const INSTALL_NAME = "zero-engine";

export const linkMachine = async (opts: {
  username?: string;
  out: (line: string) => void;
  wait: (ms: number) => Promise<void>;
}): Promise<SessionCache> => {
  const cache = await ensureRegistered({ installName: INSTALL_NAME });
  const code = await startDeviceCode(cache, opts.username);
  opts.out(`Open ${code.verification_url} and enter the code:\n\n    ${code.user_code}\n`);
  const interval = Math.max(1, code.interval ?? 5) * 1000;
  const deadline = Date.now() + (code.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    const status = await pollLinkStatus(cache);
    if (status.status === "approved") {
      const next = updateCache({ user_id: status.user_id });
      opts.out(`Linked: this machine acts as @${status.username ?? "your bot"}.`);
      return next;
    }
    // The type only models "pending" | "approved"; the cast guards the value
    // the backend actually sends, which is wider than what TS can see here.
    if ((status.status as string) !== "pending") throw new Error(`link ${status.status}`);
    await opts.wait(interval);
  }
  throw new Error("the code expired before it was approved; run `zeromind link` again");
};

/** Claude Code reads `${ZEROMIND_INSTALL_SECRET}` in the plugin's `.mcp.json` from its settings `env`. */
export const writeClaudeEnv = (
  secret: string,
  settingsPath = join(homedir(), ".claude", "settings.json"),
): "written" | "updated" | "exists" => {
  const existed = existsSync(settingsPath);
  let json: Record<string, unknown> = {};
  if (existed) {
    try {
      json = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`${settingsPath} is not valid JSON; fix or move it, then run zeromind link again`);
    }
  }
  const env = { ...((json.env as Record<string, string>) ?? {}) };
  if (env[SECRET_ENV] === secret) return "exists";
  env[SECRET_ENV] = secret;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ ...json, env }, null, 2) + "\n");
  return existed ? "updated" : "written";
};

const HELP = `zeromind link [--username <handle>]   link this machine to your ZeroMind account (once)
zeromind status                      what this machine is linked as
zeromind unlink                      revoke this machine's link
zeromind install <harness>           write the remote /mcp server entry into a harness (links first if needed)
zeromind upload <path> --world <w>   copy a file or folder into a world's engine VFS
`;

export const runLinkCli = async (argv: string[]): Promise<void> => {
  const out = (s: string) => process.stdout.write(s + "\n");
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  switch (argv[0]) {
    case "link": {
      const at = argv.indexOf("--username");
      const cache = await linkMachine({ username: at >= 0 ? argv[at + 1] : undefined, out, wait });
      const secret = installSecret(cache);
      if (secret && existsSync(join(homedir(), ".claude"))) {
        out(`Claude Code: ${writeClaudeEnv(secret)} ${SECRET_ENV} in ~/.claude/settings.json (restart Claude Code).`);
      }
      return;
    }
    case "status": {
      const cache = loadCache();
      if (!cache || !installSecret(cache)) out("not linked — run `zeromind link`");
      else out(`linked (install ${cache.install_id}, user ${cache.user_id ?? "?"}, issuer ${cache.issuer ?? "https://origozero.ai"})`);
      return;
    }
    case "unlink": {
      const cache = loadCache();
      if (cache && installSecret(cache)) await unlink({ ...cache, install_secret: installSecret(cache) });
      out("unlinked");
      return;
    }
    default:
      process.stdout.write(HELP);
  }
};
