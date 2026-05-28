import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Condensed orientation sent to every MCP client on `initialize`. Clients
 * (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, OpenCode, Cline,
 * Continue, Windsurf, Zed, …) include this in the agent's system prompt, so
 * the agent learns what ZeroMind is and the find-before-build workflow even
 * when it has no other onboarding. The full guides live in `zeromind.help`
 * and (for Claude Code) in the bundled skills — this is the elevator pitch
 * that gets agents to the first correct tool call.
 */
export const INSTRUCTIONS = `ZeroMind is a shared content library + a 3D engine you drive remotely.

The engine (Zero) runs in the user's web browser at https://origozero.ai. Work is organised into **worlds**: persistent multiplayer projects backed by ZeroMind. You attach to a world the user has open, then iterate on it with Luau scripting, the engine VFS, and screenshots.

ZeroMind itself is the **shared library of published worlds + assets** (modules, components, tools, materials, shaders, scenes, packages) that other people and agents already made. It's not just storage — it's the first place you look.

## The rule: check ZeroMind FIRST

Before writing a single line for any "make me a X" / "add a Y" request, run \`zeromind.search\`. Three winning outcomes, in order of preference:
- **A — Drop-in solution** (\`compat_tier: compatible\`): \`zeromind.install\` it, done.
- **B — Reusable parts**: install a few assets and write only the glue.
- **C — A base to modify**: install the closest match and adapt instead of starting empty.

Only build from scratch when search genuinely turns up nothing usable — and then publish your result so the next agent gets outcome A.

## The tools you have

- **Identity** — \`auth_status\` (call this FIRST), \`zm_link\`/\`zm_link_poll\` (one-time device-code link), \`zm_unlink\`.
- **ZeroMind library** — \`zeromind.search\` (find), \`zeromind.inspect\` (vet), \`zeromind.install\` (bring into the connected world; engine fetches the bytes — you never download content here), \`zeromind.engage\` (vote / comment / review / bookmark / follow / report).
- **Worlds** — \`world.list\`, \`world.create\`, \`world.launch\` (opens the browser tab), \`world.connect\` (attach to a session; \`auto_launch:true\` combines both), \`world.disconnect\`.
- **Engine** (requires a connected world) — \`execute\` (Luau), \`guides\` (engine docs; call with no args FIRST after connecting), \`capture\` (screenshot), \`read_file\`/\`write_file\`/\`edit_file\` (VFS at \`/zero/...\`), \`bash\`, \`luau_test\`, \`instance_health\`.
- **Self-help** — \`zeromind.help\` returns the full reference for any topic (\`getting-started\`, \`library\`, \`linking\`, \`workflow\`, \`tools\`). Call it when you want the long-form guide.

## The end-to-end workflow

1. \`auth_status\` — if unlinked, follow \`zm_link\` → tell the user the URL + code → poll \`zm_link_poll\`.
2. \`zeromind.search\` for what the user asked for. Try 2–3 phrasings — the index is semantic.
3. \`zeromind.inspect\` the best hit (overview = schema + capabilities + review + comments + dependents).
4. \`world.connect { name, auto_launch: true }\` (or create a new world first with \`world.create\`).
5. \`zeromind.install\` the chosen content into the connected world.
6. \`guides()\` (no args) — read the engine README before touching Luau.
7. Iterate with \`execute\` / \`read_file\` / \`write_file\` / \`edit_file\` / \`capture\`. Verify visually after every meaningful change.
8. Publish with \`execute({code: "zm.add('.'); zm.commit('msg'); zm.push()"})\`, then \`zeromind.engage\` to vote / comment on what you used.

## Hard rules

- Never reimplement what's already published — search first.
- Never guess Luau API names — use \`guides()\` and \`execute({code:"return type(_G.name)"})\` to discover.
- Never "download" content to this client — content is only operable in the engine; \`zeromind.install\` is the only path in.
- Always verify visually (\`capture\`) AND with data, not just by reading code.
- No shortcuts, no "for now" stubs — every change must be the real solution.

Call \`zeromind.help\` any time you want the full guides.`;

const HERE = dirname(fileURLToPath(import.meta.url));
// At runtime, this file lives at `<pkg-root>/dist/instructions.js`, so the
// bundled skills sit one level up. We ship the same .md files that Claude
// Code reads from `skills/` to other clients via `zeromind.help`, so there
// is one source of truth.
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

const loadSkill = (name: string): string | undefined => {
  const md = tryRead(join("skills", name, "SKILL.md"));
  return md ? stripFrontmatter(md) : undefined;
};

const TOPIC_FALLBACK_GETTING_STARTED = INSTRUCTIONS;
const TOPIC_FALLBACK_LIBRARY = `See \`zeromind.search\` / \`zeromind.inspect\` / \`zeromind.install\` / \`zeromind.engage\` tool descriptions. The full library skill ships in the npm package under \`skills/zeromind-library/SKILL.md\` — if you don't see it here the package may be incomplete.`;

const TOPIC_LINKING = `# Linking this IDE to a ZeroMind account

The plugin registers a per-install ZeroMind principal and links it to the user's account via a one-time device-code flow. Once linked, the link is persisted on disk (see \`ZEROMIND_CONFIG_DIR\`) and reused on every restart.

1. Call \`auth_status\`. If \`linked: true\`, you're done.
2. Otherwise call \`zm_link\`. It returns either \`{status: "approved", user_id}\` (already linked, done) or \`{status: "pending", user_code, verification_url, expires_in, interval}\`.
3. If pending: tell the user to open **https://origozero.ai/link** in their browser, sign in if needed, and enter the \`user_code\`. Mention it expires in \`expires_in\` seconds. **Always use \`https://origozero.ai/link\` — do NOT relay the \`verification_url\` field verbatim** (the backend currently returns an \`api.origozero.ai/link\` variant; the public approval page lives on the bare domain).
4. Poll \`zm_link_poll\` every \`interval\` seconds (default 5). When it returns \`{status: "approved", user_id}\`, confirm to the user and proceed.
5. If polling keeps returning pending past expiry, the code expired — call \`zm_link\` again for a fresh one.

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
7. capture to verify → adapt with edit_file/execute → zm.add('.'); zm.commit('msg'); zm.push()
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
- \`zm_link\` / \`zm_link_poll\` — device-code link flow. See \`zeromind.help { topic: "linking" }\`.
- \`zm_unlink\` — revoke and delete the local install.

## ZeroMind library
- \`zeromind.search\` — semantic search across published worlds and assets. Scopes: \`assets\` (default), \`worlds\`, \`both\`, \`feed\`, \`similar\`, \`top_by_kind\`, \`kinds\`, \`capabilities\`, \`schemas\`. Filters AND-combine: \`kind\`, \`lang\`, \`capability\`, \`tag\`, \`license\`, \`conforms_to\`, \`provides_schema\`. Read each hit's \`compat_tier\`, \`agent_score\`, \`pulled_into_count\`, capabilities — prefer \`compatible\` + high adoption.
- \`zeromind.inspect\` — drill into one world/asset. Default \`view: "overview"\` aggregates everything you need to judge it. Narrower views (asset): \`detail\` | \`closure\` | \`children\` | \`dependents\` | \`pulls\` | \`comments\`. (World): \`detail\` | \`summary\` | \`contents\` | \`published\` | \`comments\`.
- \`zeromind.install\` — the only way to bring content in. Pass \`guid\` (asset mode — lands at \`/source/<name>\`) or \`world\` (library mode — mounts as \`@<name>\`). Requires a connected world.
- \`zeromind.engage\` — \`vote\` / \`comment\` / \`review\` / \`bookmark\` / \`follow\` / \`report\` / \`record_pull\`.

## Worlds
- \`world.list\` — the linked user's worlds.
- \`world.create { name, template?, public? }\` — make a new one.
- \`world.open_in_browser { name | guid }\` — return the URL (relay to the user manually).
- \`world.launch { name | guid }\` — spawn the OS \`open\`/\`xdg-open\`/\`start\` to open it.
- \`world.connect { name | guid, auto_launch?, timeout_ms? }\` — attach to a session. \`auto_launch: true\` combines launch+connect.
- \`world.disconnect\`.

## Engine (need a connected world)
- \`execute { code }\` — Luau snippet in the engine.
- \`guides { path?, query?, list? }\` — engine docs. \`guides()\` (no args) first after every \`world.connect\`.
- \`capture { pass?, layers?, width?, height?, format? }\` — screenshot, base64 PNG.
- \`read_file\` / \`write_file\` / \`edit_file\` — engine VFS at \`/zero/...\`.
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
      return loadSkill("zeromind-getting-started") ?? TOPIC_FALLBACK_GETTING_STARTED;
    case "library":
      return loadSkill("zeromind-library") ?? TOPIC_FALLBACK_LIBRARY;
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
  `\n\nAll IDEs (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, and any other MCP-capable client) see the same content here. ` +
  `Claude Code users also get this content as bundled skills (\`zeromind-getting-started\`, \`zeromind-library\`); ` +
  `other clients should call this tool when they want the same depth.\n\n` +
  `The condensed orientation is also delivered via the MCP \`instructions\` field on initialize — check your client's system prompt if you've seen it already.`;
