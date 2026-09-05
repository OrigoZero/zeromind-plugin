import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ensureRegistered } from "./install.js";
import { pollLinkStatus, startDeviceCode, unlink } from "./link.js";
import { installSecret, loadCache, updateCache, type SessionCache } from "./config.js";
import { SECRET_ENV } from "./server-spec.js";

const INSTALL_NAME = "zero-engine";

/** Who the linked install acts as — the handle when ZeroMind answers, and
 *  "your bot" when it doesn't: naming the account is a courtesy on top of
 *  "this machine is linked", which is true offline too. */
const linkedBot = async (cache: SessionCache): Promise<string> => {
  try {
    const status = await pollLinkStatus(cache);
    if (status.status === "approved" && status.username) return `@${status.username}`;
  } catch {
    /* the link stands whether or not this call reaches ZeroMind */
  }
  return "your bot";
};

export const linkMachine = async (opts: {
  username?: string;
  out: (line: string) => void;
  wait: (ms: number) => Promise<void>;
}): Promise<SessionCache> => {
  // One linked install per machine: a machine that already holds an approved
  // one is linked, and says so rather than minting a second code for an
  // operator to approve again. `zeromind unlink` is how a machine is re-linked.
  const linked = loadCache();
  const secret = linked && installSecret(linked);
  if (linked && secret && linked.user_id) {
    const cache = { ...linked, install_secret: secret };
    opts.out(`Already linked: this machine acts as ${await linkedBot(cache)}.`);
    return cache;
  }
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

/** Take `${SECRET_ENV}` back out of Claude Code's settings when it holds the
 *  credential being revoked — the inverse of `writeClaudeEnv`. A different
 *  value belongs to something else and is left alone. */
export const clearClaudeEnv = (
  secret: string,
  settingsPath = join(homedir(), ".claude", "settings.json"),
): "removed" | "kept" | "absent" => {
  if (!existsSync(settingsPath)) return "absent";
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`${settingsPath} is not valid JSON`);
  }
  const env = { ...((json.env as Record<string, string>) ?? {}) };
  if (env[SECRET_ENV] === undefined) return "absent";
  if (env[SECRET_ENV] !== secret) return "kept";
  delete env[SECRET_ENV];
  const next = { ...json, env };
  if (Object.keys(env).length === 0) delete (next as { env?: unknown }).env;
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  return "removed";
};

const HELP = `zeromind link [--username <handle>]   link this machine to your ZeroMind account (once; on a linked machine it says who and stops)
zeromind status                      what this machine is linked as
zeromind unlink                      revoke this machine's link (unlink, then link, is how a machine is re-linked)
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
      const secret = cache && installSecret(cache);
      if (!cache || !secret) {
        out("This machine holds no ZeroMind link.");
        return;
      }
      // The secret comes out of the file that holds it first, and a file
      // this cannot read is reported rather than thrown: an unlink that has
      // already revoked upstream must not report itself as failed, and a
      // second run would find no link left to clean up after.
      let claudeNote: string | undefined;
      try {
        if (clearClaudeEnv(secret) === "removed") {
          claudeNote = `Claude Code: removed ${SECRET_ENV} from ~/.claude/settings.json (restart Claude Code).`;
        }
      } catch (e) {
        claudeNote = `Claude Code: ${(e as Error).message} — ${SECRET_ENV} is still in it; remove that one line by hand.`;
      }
      const outcome = await unlink({ ...cache, install_secret: secret });
      out(
        outcome === "revoked"
          ? "Unlinked: this machine holds no ZeroMind link."
          : "ZeroMind already held no such install; this machine's link is cleared.",
      );
      if (claudeNote) out(claudeNote);
      out(
        "The revoked secret is still in the harness configs `zeromind install` wrote; they answer 401 until you link again and re-run the install.",
      );
      return;
    }
    default:
      process.stdout.write(HELP);
  }
};
