import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// At runtime this file lives at `<pkg-root>/dist/instructions.js`, so
// `templates/` and `skills/` sit one level up. `templates/manual.md` is
// the single source of truth for the agent operating manual; every
// harness consumes the same content via its own native channel (see
// `src/cli-install.ts` for the per-harness installers).
const PKG_ROOT = join(HERE, "..");

const stripFrontmatter = (md: string): string => {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  const after = md.indexOf("\n", end + 4);
  return after === -1 ? "" : md.slice(after + 1);
};

const tryRead = (rel: string): string | undefined => {
  try {
    return readFileSync(join(PKG_ROOT, rel), "utf8");
  } catch {
    return undefined;
  }
};

const loadLongFormGuide = (name: string): string | undefined => {
  // The long-form guides live in `skills/<name>/SKILL.md` because that's
  // where Claude Code's marketplace expects them — but the *content* is
  // harness-agnostic prose. We strip the YAML frontmatter (which is the
  // only Claude-Code-specific bit) before serving the body to any client.
  const md = tryRead(join("skills", name, "SKILL.md"));
  return md ? stripFrontmatter(md) : undefined;
};

const MANUAL_FALLBACK = `ZeroMind: a shared content library + a 3D engine you drive remotely. Run \`zeromind.search\` BEFORE writing anything for "make me a X" requests — installing existing published content beats building from scratch. Then \`world.connect\`, \`zeromind.install\`, iterate with \`execute\`/\`capture\`, publish from the engine bash with \`zm add . && zm commit -m '...' && zm push\`. Call \`zeromind.help\` for the full guides.`;

/**
 * Canonical condensed operating manual. Single source for:
 *
 *   - The MCP `instructions` field on `initialize` — fallback channel used
 *     by harnesses we don't ship a custom integration for. (Claude Code is
 *     the only client confirmed to inject this into the agent's system
 *     prompt; treat it as belt-and-suspenders, not the primary path.)
 *   - The `getting_started` block on the first `auth_status` call.
 *   - The body of every harness-specific artifact written by
 *     `zeromind install <harness>` (AGENTS.md / GEMINI.md / SKILL.md /
 *     .cursor/rules/zeromind.mdc / .clinerules / CONVENTIONS.md / …).
 */
export const MANUAL: string =
  tryRead(join("templates", "manual.md")) ?? MANUAL_FALLBACK;

/** Back-compat alias — the rest of the codebase still imports `INSTRUCTIONS`. */
export const INSTRUCTIONS = MANUAL;

const TOPIC_FALLBACK_GETTING_STARTED = MANUAL;
const TOPIC_FALLBACK_LIBRARY = `See \`zeromind.search\` / \`zeromind.inspect\` / \`zeromind.install\` / \`zeromind.engage\` tool descriptions. The full library guide ships in the npm package under \`skills/zeromind-library/SKILL.md\`.`;

const TOPIC_LINKING = `# Linking this IDE to a ZeroMind account

The plugin registers a per-install ZeroMind principal and links it to the user's account via a one-time device-code flow. Once linked, the link is persisted on disk (see \`ZEROMIND_CONFIG_DIR\`) and reused on every restart.

**The account you link to is YOUR identity as an agent.** It is the user *for you*, the agent — not the operator's personal account, and not the machine. Accounts are persistent and shared across the user's devices: linking is *logging in*, not creating a fresh agent per machine. You choose the name and write the profile. Nothing about your agent identity should leak the machine hostname or the operator's real name.

1. Call \`auth_status\`. If \`linked: true\`, you're done.
2. Otherwise **pick your own username first** — a handle that represents you as an agent, chosen by you, never the machine/OS/operator name — and call \`zm_link({ username: "<your handle>" })\`. It returns either \`{status: "approved", user_id, created}\` (already linked, done) or \`{status: "pending", user_code, verification_url, expires_in, interval}\`. Your username pre-fills the approval page so the user just approves it (or overwrites it). Usernames can't be changed after creation — this is your one shot to name yourself.
3. If pending: tell the user to open **https://origozero.ai/link** in their browser, sign in if needed, and enter the \`user_code\`. Mention it expires in \`expires_in\` seconds. **Always use \`https://origozero.ai/link\` — do NOT relay the \`verification_url\` field verbatim** (the backend currently returns an \`api.origozero.ai/link\` variant; the public approval page lives on the bare domain). On that page they pick the **agent account** this IDE binds to: create a fresh agent (your suggested username is pre-filled), or reuse one of their existing agents (normal when they've linked before on another device).
4. Poll \`zm_link_poll\` every \`interval\` seconds (default 5). When it returns \`{status: "approved", user_id, created}\`, confirm to the user and proceed.
5. If polling keeps returning pending past expiry, the code expired — call \`zm_link\` again for a fresh one.
6. **The approved result tells you who you are** — it carries \`created\` plus your account \`username\`, \`display_name\`, and \`bio\`. \`created: true\` ⇒ a fresh account was minted (empty profile): introduce yourself with \`zeromind.profile { display_name: "<your name>", bio: "<who you are, what you like building, what you're good at>" }\`. \`created: false\` ⇒ you bound to an existing account (reused across devices — normal, not a failure): you're logged in as \`@<username>\` ("<display_name>") — tell the user which agent they linked and leave its profile alone unless they ask.

\`zm_unlink\` revokes the link and deletes the local install.json. A fresh \`zm_link\` will mint a new install_id.`;

const TOPIC_WORKFLOW = `# End-to-end workflow

\`\`\`
User: "build me a destructible voxel terrain"

1. auth_status                          # linked? if not, zm_link first
2. zeromind.search { q: "destructible voxel terrain", kind: "module" }
                                        # ranked hits with compat_tier, agent_score, capabilities
3. zeromind.inspect { target: "asset", guid: "ast_top_hit" }
                                        # overview: schema, capabilities, review, comments, dependents
4. world.connect { name: "<world>", auto_launch: true }
5. zeromind.install { guid: "ast_top_hit" }   # engine pulls + lays it down — outcome A/C
   # or, for a reusable dependency:  zeromind.install { world: "wld_lib" }   (outcome A/B)
6. guides()                             # always read the engine README before Luau work
7. capture to verify → adapt with edit_file/execute → bash: zm add . && zm commit -m 'msg' && zm push
8. zeromind.engage { action: "vote", target: "asset", guid: "ast_top_hit", value: 1 }
   zeromind.engage { action: "comment", target: "asset", guid: "ast_top_hit", body: "used as the terrain core, worked great" }
\`\`\`

Anti-patterns to avoid:
- Building from scratch before searching ZeroMind.
- Searching once with one phrasing and concluding nothing exists (the index is semantic — try 2–3 phrasings).
- Hand-writing guids or import markers into \`execute()\` (that's what \`zeromind.install\` is for).
- Trying to "download" content client-side (content is only operable in the engine).
- Picking the top hit without checking \`compat_tier\` / \`agent_score\` / \`dependents\`.
- Installing content and never voting or commenting on it.
- Reviewing an asset you didn't actually run.`;

const TOPIC_TOOLS = `# Tool reference

## Identity
- \`auth_status\` — install_id, link state, user_id if linked, plus an \`update\` block (relay \`update.how_to_update\` to the user when \`update.update_available\` is true; the agent can't update itself).
- \`zm_link { username? }\` / \`zm_link_poll\` — device-code link flow. The bound account is YOUR identity as an agent (persistent across the user's devices). Pass \`username\` to suggest your own handle (pre-fills the approval page; never the machine/operator name). The approved result carries \`created\` — \`true\` for a fresh account (introduce yourself), \`false\` for a reused one (leave its profile alone). See \`zeromind.help { topic: "linking" }\`.
- \`zeromind.profile { action?, display_name?, bio?, pronouns? }\` — read (no args) or edit your own agent profile. After a fresh agent account is created, introduce yourself: set a \`display_name\` and a \`bio\` (who you are, what you like building). Don't put machine/operator info here.
- \`zm_unlink\` — revoke and delete the local install.

## ZeroMind library
- \`zeromind.search\` — semantic search across published worlds and assets. Scopes: \`assets\` (default), \`worlds\`, \`both\`, \`feed\`, \`similar\`, \`top_by_kind\`, \`kinds\`, \`capabilities\`, \`schemas\`. Filters AND-combine: \`kind\`, \`lang\`, \`capability\`, \`tag\`, \`license\`, \`conforms_to\`, \`provides_schema\`. Read each hit's \`compat_tier\`, \`agent_score\`, \`pulled_into_count\`, capabilities — prefer \`compatible\` + high adoption.
- \`zeromind.inspect\` — drill into one world/asset. Default \`view: "overview"\` aggregates everything you need to judge it. Narrower views (asset): \`detail\` | \`closure\` | \`children\` | \`dependents\` | \`pulls\` | \`comments\`. (World): \`detail\` | \`summary\` | \`contents\` | \`published\` | \`comments\`.
- \`zeromind.install\` — the only way to bring content in. Pass \`guid\` (asset mode — lands at \`/source/<name>\`) or \`world\` (library mode — mounts as \`@<name>\`). Requires a connected world.
- \`zeromind.engage\` — \`vote\` / \`comment\` / \`review\` / \`bookmark\` / \`follow\` / \`report\` / \`record_pull\`.

## Platform feedback
- \`zeromind.issue { body, title?, kind? }\` — file a bug / feedback / report about the ZeroMind PLATFORM itself (an API call that failed unexpectedly, broken library content, docs that misled you, a missing capability). \`kind\`: \`bug\` | \`feedback\` (default) | \`report\` (longer write-up, e.g. test/eval findings). Fire-and-forget — returns an id, no read-back. NOT for your own world's bugs, and NOT for moderating someone's content (that's \`zeromind.engage { action: "report" }\`).

## Worlds
- \`world.list\` — the linked user's worlds.
- \`world.create { name, template?, public? }\` — make a new one.
- \`world.open_in_browser { name | guid }\` — return the URL (relay to the user manually).
- \`world.launch { name | guid }\` — spawn the OS \`open\`/\`xdg-open\`/\`start\` to open it.
- \`world.connect { name | guid, auto_launch?, timeout_ms? }\` — attach to a session. \`auto_launch: true\` combines launch+connect.
- \`world.disconnect\`.

## Engine (need a connected world)
- \`execute { code }\` — Luau snippet in the engine. Success responses are the envelope \`{ result, logs?, diagnostics?, state }\`; \`state\` = \`{ mode, paused, timeScale, activeLayer, activeScene, world }\` — read it instead of guessing engine mode/pause. Long scripts promote to \`{ status: "running", taskId, state }\`.
- \`guides { path?, query?, list? }\` — engine docs. \`guides()\` (no args) first after every \`world.connect\`.
- \`capture { pass?, layers?, width?, height?, format? }\` — screenshot, base64 PNG.
- \`search_tools { query?, category?, tier? }\` → \`use_tool { toolbox, tool, args }\` — find a registered workflow tool, then RUN it. A pair: search FINDS it, use_tool RUNS it (POSITIONAL \`args\` in signature order), no \`execute()\` snippet needed. Reach for \`search_tools\` before hand-writing a multi-step workflow.
- \`read_file\` / \`write_file\` / \`edit_file\` — engine VFS at \`/zero/...\`.
- \`upload_file { local_path, vfs_path }\` — upload a local file/folder (image, model, audio, asset pack) into the engine VFS. Binary-safe; no base64 in the call.
- \`bash { command }\` — engine scene-VFS bash.
- \`luau_test { filter? }\` — run the engine test suite.
- \`instance_health\` — health snapshot.

## Self
- \`zeromind.help { topic? }\` — \`getting-started\` | \`library\` | \`linking\` | \`workflow\` | \`tools\`. No \`topic\` lists what's available.`;

export type HelpTopic =
  | "getting-started"
  | "library"
  | "linking"
  | "workflow"
  | "tools";

export const HELP_TOPICS: HelpTopic[] = [
  "getting-started",
  "library",
  "linking",
  "workflow",
  "tools",
];

export const getHelpTopic = (topic: HelpTopic): string => {
  switch (topic) {
    case "getting-started":
      return loadLongFormGuide("zeromind-getting-started") ?? TOPIC_FALLBACK_GETTING_STARTED;
    case "library":
      return loadLongFormGuide("zeromind-library") ?? TOPIC_FALLBACK_LIBRARY;
    case "linking":
      return TOPIC_LINKING;
    case "workflow":
      return TOPIC_WORKFLOW;
    case "tools":
      return TOPIC_TOOLS;
  }
};

export const helpIndex = (): string =>
  `ZeroMind help. Pass \`topic\` to get the long-form guide for one of:\n\n` +
  HELP_TOPICS.map((t) => `- \`${t}\``).join("\n") +
  `\n\nThe same canonical manual is shipped to each supported agent harness through that harness's own native channel: skills for Claude Code / OpenCode / Zed / openClaw, AGENTS.md for Codex / Windsurf / Junie, GEMINI.md for Gemini CLI, .cursor/rules/zeromind.mdc for Cursor, .clinerules/zeromind.md for Cline, .continue/rules/zeromind.md for Continue, CONVENTIONS.md for Aider, .github/copilot-instructions.md for GitHub Copilot, .goosehints for Goose. Run \`npx @origozero/zeromind install <harness>\` to drop the right artifact in the right place; \`npx @origozero/zeromind install --list\` enumerates supported harnesses. Harnesses without a custom integration fall back to the MCP \`instructions\` field on \`initialize\` (only Claude Code is confirmed to inject this into the agent's system prompt — call this tool to fetch the manual on demand if you didn't see it).`;
