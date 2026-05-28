import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MANUAL } from "./instructions.js";

/**
 * Per-harness install map. Every entry is a custom-crafted integration for
 * one agent harness — there is no "generic native" mechanism, because each
 * harness loads agent context from a different path with a different
 * wrapper format. Anything not listed here gets the generic MCP
 * `instructions` field + the `zeromind.help` tool as fallback.
 *
 * For each harness we ship the SAME canonical content (`templates/manual.md`,
 * exposed at runtime as `MANUAL`), wrapped in the harness's native format
 * and written at the harness's native discovery path.
 *
 * Sources for each path / format are in `ide/<harness>/README.md`.
 */

export type Harness =
  | "claude"
  | "cursor"
  | "codex"
  | "gemini"
  | "opencode"
  | "cline"
  | "continue"
  | "windsurf"
  | "zed"
  | "openclaw"
  | "aider"
  | "copilot"
  | "goose"
  | "junie"
  | "amp";

type Scope = "project" | "global";

type Artifact = {
  /** Relative path inside the project (when scope=project) or absolute path
   *  under $HOME (when scope=global). Use `~/...` for the global form. */
  path: string;
  /** Content to write. Receives the canonical manual body. */
  body: (manual: string) => string;
  /** When set, append/replace a delimited block inside the existing file
   *  instead of overwriting it. Used for shared files like AGENTS.md /
   *  CONVENTIONS.md that the user may already have populated. */
  block?: { begin: string; end: string };
};

type HarnessSpec = {
  /** Human display name (for `--list` and logs). */
  name: string;
  /** One-liner describing the harness's native onboarding channel. */
  channel: string;
  /** Where to install (per-scope). `global` may be undefined for harnesses
   *  that only have a per-project convention. */
  project?: Artifact;
  global?: Artifact;
  /** Default scope when the user didn't pass --global / --project. */
  defaultScope: Scope;
  /** Extra one-time setup the user should do (e.g. add a line to a config
   *  file the installer can't safely touch). Printed after the install. */
  followUp?: string;
};

// ─── Wrappers ────────────────────────────────────────────────────────────

const skillFrontmatter = (
  name: string,
  description: string,
): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n`;

const SKILL_DESCRIPTION =
  "ZeroMind is a shared library of published worlds + assets and a 3D engine you drive remotely. Check ZeroMind first before building from scratch; install with `zeromind.install`; iterate in the connected world with `execute`/`capture`. Activate for any 'make me a X' / 'add a Y' Zero engine request.";

const skillFile = (manual: string): string =>
  skillFrontmatter("zeromind", SKILL_DESCRIPTION) + manual;

const cursorMdcFrontmatter = (description: string): string =>
  `---\ndescription: ${description}\nalwaysApply: false\n---\n\n`;

const cursorMdcFile = (manual: string): string =>
  cursorMdcFrontmatter(SKILL_DESCRIPTION) + manual;

const plain = (manual: string): string => manual;

const BLOCK_BEGIN = "<!-- BEGIN ZEROMIND -->";
const BLOCK_END = "<!-- END ZEROMIND -->";
const sharedBlock = (manual: string): string =>
  `${BLOCK_BEGIN}\n\n## ZeroMind\n\n${manual}\n\n${BLOCK_END}\n`;

// ─── Harnesses ───────────────────────────────────────────────────────────

const HARNESSES: Record<Harness, HarnessSpec> = {
  claude: {
    name: "Claude Code",
    channel:
      "skills (`<scope>/.claude/skills/<name>/SKILL.md`) — auto-discovered, progressive disclosure via the YAML frontmatter",
    project: {
      path: ".claude/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    global: {
      path: "~/.claude/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    defaultScope: "project",
    followUp:
      "Claude Code marketplace install is the recommended path:\n  /plugin marketplace add OrigoZero/zeromind-plugin\n  /plugin install zeromind\nThe skill written by this command works too — useful when you want the skill without the marketplace plugin.",
  },

  cursor: {
    name: "Cursor",
    channel:
      "project rules (`.cursor/rules/<name>.mdc`) — MDC frontmatter selects activation mode (agent-requested via `description`)",
    project: {
      path: ".cursor/rules/zeromind.mdc",
      body: cursorMdcFile,
    },
    defaultScope: "project",
    followUp:
      "Also wire the MCP server in `.cursor/mcp.json` — see ide/cursor/install-link.md for the one-click install link.",
  },

  codex: {
    name: "Codex CLI",
    channel: "AGENTS.md (project root or `~/.codex/AGENTS.md`)",
    project: {
      path: "AGENTS.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    global: {
      path: "~/.codex/AGENTS.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "global",
    followUp:
      "Wire the MCP server in `~/.codex/config.toml`:\n  [mcp_servers.zeromind]\n  command = \"npx\"\n  args = [\"-y\", \"@origozero/zeromind\"]\n  [mcp_servers.zeromind.env]\n  ZEROMIND_IDE_NAME = \"codex\"",
  },

  gemini: {
    name: "Gemini CLI",
    channel: "GEMINI.md (project root or `~/.gemini/GEMINI.md`)",
    project: {
      path: "GEMINI.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    global: {
      path: "~/.gemini/GEMINI.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "global",
    followUp:
      "Wire the MCP server in `~/.gemini/settings.json`:\n  { \"mcpServers\": { \"zeromind\": { \"command\": \"npx\", \"args\": [\"-y\", \"@origozero/zeromind\"], \"env\": { \"ZEROMIND_IDE_NAME\": \"gemini-cli\" } } } }",
  },

  opencode: {
    name: "OpenCode",
    channel:
      "skills (`.opencode/skills/<name>/SKILL.md` or `~/.config/opencode/skills/<name>/SKILL.md`) — also reads `.claude/skills/` and `AGENTS.md`",
    project: {
      path: ".opencode/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    global: {
      path: "~/.config/opencode/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    defaultScope: "project",
    followUp:
      "OpenCode also auto-discovers `.claude/skills/zeromind/SKILL.md` — if you've already run `zeromind install claude` you may not need this too.\nWire the MCP server in `opencode.jsonc`:\n  { \"mcp\": { \"zeromind\": { \"type\": \"local\", \"command\": [\"npx\", \"-y\", \"@origozero/zeromind\"], \"environment\": { \"ZEROMIND_IDE_NAME\": \"opencode\" }, \"enabled\": true } } }",
  },

  cline: {
    name: "Cline",
    channel: ".clinerules (single file or directory of markdown)",
    project: {
      path: ".clinerules/zeromind.md",
      body: plain,
    },
    defaultScope: "project",
    followUp:
      "Wire the MCP server through Cline's MCP Servers UI (Command Palette → \"Cline: MCP Servers\" → Configure). See ide/cline/README.md for the JSON block.",
  },

  continue: {
    name: "Continue",
    channel: ".continue/rules/<name>.md (auto-activated in that project)",
    project: {
      path: ".continue/rules/zeromind.md",
      body: plain,
    },
    defaultScope: "project",
    followUp:
      "Wire the MCP server in `~/.continue/config.yaml`:\n  mcpServers:\n    - name: zeromind\n      command: npx\n      args: [\"-y\", \"@origozero/zeromind\"]\n      env: { ZEROMIND_IDE_NAME: continue }",
  },

  windsurf: {
    name: "Windsurf",
    channel:
      "AGENTS.md (Cascade reads it dynamically as it navigates the project; the legacy `.windsurfrules` still works)",
    project: {
      path: "AGENTS.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "project",
    followUp:
      "Wire the MCP server in `~/.codeium/windsurf/mcp_config.json` — see ide/windsurf/README.md.",
  },

  zed: {
    name: "Zed",
    channel:
      "agent skills (`.claude/skills/<name>/SKILL.md` is auto-discovered) plus project `AGENTS.md`",
    project: {
      path: ".claude/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    global: {
      path: "~/.claude/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    defaultScope: "project",
    followUp:
      "Wire the MCP server in `~/.config/zed/settings.json` under `context_servers` — see ide/zed/README.md.",
  },

  openclaw: {
    name: "openClaw",
    channel:
      "skills (`<workspace>/skills/<name>/SKILL.md` or `~/.openclaw/skills/<name>/SKILL.md`) — AgentSkills-compatible (same shape as Claude Code skills)",
    project: {
      path: "skills/zeromind/SKILL.md",
      body: skillFile,
    },
    global: {
      path: "~/.openclaw/skills/zeromind/SKILL.md",
      body: skillFile,
    },
    defaultScope: "project",
    followUp:
      "You can also `openclaw skills install @origozero/zeromind` (or publish to ClawHub). MCP support in openClaw is unconfirmed — the skill is the primary channel.",
  },

  aider: {
    name: "Aider",
    channel:
      "CONVENTIONS.md (project root; loaded via `aider --read CONVENTIONS.md` or `.aider.conf.yml`)",
    project: {
      path: "CONVENTIONS.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "project",
    followUp:
      "Aider has no native MCP client (as of mid-2026 — track aider-ai/aider#4506). CONVENTIONS.md is the only channel that reaches Aider; ZeroMind tool calls aren't available there.\nAdd to `.aider.conf.yml`:\n  read: [CONVENTIONS.md]",
  },

  copilot: {
    name: "GitHub Copilot",
    channel:
      ".github/copilot-instructions.md (per-repo; auto-loaded by Copilot Chat / VS Code Copilot agent mode)",
    project: {
      path: ".github/copilot-instructions.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "project",
    followUp:
      "VS Code Copilot agent mode also speaks MCP — wire the server in VS Code settings (Settings → Features → Copilot → MCP servers) with `{ \"command\": \"npx\", \"args\": [\"-y\", \"@origozero/zeromind\"], \"env\": { \"ZEROMIND_IDE_NAME\": \"copilot\" } }`.",
  },

  goose: {
    name: "Block Goose",
    channel: "`~/.config/goose/.goosehints` (global instructions file)",
    global: {
      path: "~/.config/goose/.goosehints",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "global",
    followUp:
      "Goose is MCP-native — also register the server with `goose mcp add zeromind -- npx -y @origozero/zeromind` (or via the desktop UI).",
  },

  junie: {
    name: "JetBrains Junie",
    channel: "AGENTS.md (project root; Junie reads the standard convention)",
    project: {
      path: "AGENTS.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "project",
    followUp:
      "Junie's MCP support is via the JetBrains IDE settings → AI Assistant → MCP Servers.",
  },

  amp: {
    name: "Sourcegraph Amp",
    channel: "AGENT.md (singular — distinct from the cross-tool AGENTS.md)",
    project: {
      path: "AGENT.md",
      body: sharedBlock,
      block: { begin: BLOCK_BEGIN, end: BLOCK_END },
    },
    defaultScope: "project",
    followUp:
      "Amp's MCP server config lives in its settings UI.",
  },
};

// ─── Installer ───────────────────────────────────────────────────────────

const expand = (p: string): string =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const writeIfNew = (
  abs: string,
  content: string,
  force: boolean,
): "written" | "exists" => {
  if (existsSync(abs) && !force) return "exists";
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return "written";
};

const upsertBlock = (
  abs: string,
  begin: string,
  end: string,
  block: string,
): "written" | "updated" => {
  mkdirSync(dirname(abs), { recursive: true });
  let existing = "";
  let mode: "written" | "updated" = "written";
  if (existsSync(abs)) {
    existing = readFileSync(abs, "utf8");
    mode = "updated";
  }
  const beginIdx = existing.indexOf(begin);
  const endIdx = existing.indexOf(end);
  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Replace existing ZeroMind block, preserve everything else.
    next =
      existing.slice(0, beginIdx) +
      block.trimEnd() +
      existing.slice(endIdx + end.length);
    // Tidy trailing whitespace.
    next = next.replace(/\n{3,}/g, "\n\n");
    if (!next.endsWith("\n")) next += "\n";
  } else {
    const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
    next = existing + sep + block;
  }
  writeFileSync(abs, next);
  return mode;
};

export type InstallResult = {
  harness: Harness;
  name: string;
  scope: Scope;
  path: string;
  status: "written" | "exists" | "updated";
  followUp?: string;
};

export const installHarness = (opts: {
  harness: Harness;
  scope?: Scope;
  cwd?: string;
  force?: boolean;
}): InstallResult => {
  const spec = HARNESSES[opts.harness];
  if (!spec) throw new Error(`unknown harness: ${opts.harness}`);
  const scope = opts.scope ?? spec.defaultScope;
  const artifact = scope === "global" ? spec.global : spec.project;
  if (!artifact) {
    const alt = scope === "global" ? spec.project : spec.global;
    if (!alt) throw new Error(`${spec.name}: no install artifact defined`);
    throw new Error(
      `${spec.name}: no ${scope} install path; only ${scope === "global" ? "project" : "global"} is supported here.`,
    );
  }
  const cwd = opts.cwd ?? process.cwd();
  const abs = artifact.path.startsWith("~/")
    ? expand(artifact.path)
    : join(cwd, artifact.path);
  const body = artifact.body(MANUAL);
  let status: InstallResult["status"];
  if (artifact.block) {
    status = upsertBlock(abs, artifact.block.begin, artifact.block.end, body);
  } else {
    status = writeIfNew(abs, body, opts.force ?? false);
  }
  return {
    harness: opts.harness,
    name: spec.name,
    scope,
    path: abs,
    status,
    followUp: spec.followUp,
  };
};

export const listHarnesses = (): {
  harness: Harness;
  name: string;
  channel: string;
  scopes: Scope[];
  defaultScope: Scope;
}[] =>
  (Object.keys(HARNESSES) as Harness[]).map((h) => {
    const s = HARNESSES[h];
    const scopes: Scope[] = [];
    if (s.project) scopes.push("project");
    if (s.global) scopes.push("global");
    return {
      harness: h,
      name: s.name,
      channel: s.channel,
      scopes,
      defaultScope: s.defaultScope,
    };
  });

const HELP = `zeromind install <harness> [--global | --project] [--force]
zeromind install --list

Custom-crafted native install for each supported agent harness. Each writes
the canonical ZeroMind operating manual into that harness's own
auto-discovered location, in that harness's own wrapper format. Anything
not listed here falls back to the MCP \`instructions\` field (only Claude
Code is confirmed to honor it) plus the \`zeromind.help\` tool on demand.

Supported harnesses:
${listHarnesses()
  .map((h) => `  ${h.harness.padEnd(10)} ${h.name}  →  ${h.channel}`)
  .join("\n")}

Flags:
  --global   write to the user-global config dir (e.g. ~/.codex/AGENTS.md)
  --project  write to the current project (default for most harnesses)
  --force    overwrite an existing artifact at the target path
  --cwd <p>  install relative to <p> instead of $PWD
`;

/** Entry point — invoked from `bin/zeromind install ...`. */
export const runInstallCli = (argv: string[]): void => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--list" || argv[0] === "list") {
    for (const h of listHarnesses()) {
      process.stdout.write(
        `${h.harness.padEnd(10)} ${h.name}\n  channel: ${h.channel}\n  scopes:  ${h.scopes.join(", ")} (default: ${h.defaultScope})\n\n`,
      );
    }
    return;
  }
  const harness = argv[0] as Harness;
  if (!(harness in HARNESSES)) {
    process.stderr.write(
      `unknown harness '${harness}'. Run \`zeromind install --list\` to see what's supported.\n`,
    );
    process.exit(1);
  }
  let scope: Scope | undefined;
  let force = false;
  let cwd: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--global") scope = "global";
    else if (a === "--project") scope = "project";
    else if (a === "--force") force = true;
    else if (a === "--cwd") cwd = argv[++i];
    else {
      process.stderr.write(`unknown flag: ${a}\n${HELP}`);
      process.exit(1);
    }
  }
  const result = installHarness({ harness, scope, cwd, force });
  const verb =
    result.status === "exists"
      ? "skipped (file already exists; pass --force to overwrite)"
      : result.status === "updated"
        ? "updated"
        : "wrote";
  process.stdout.write(
    `zeromind: ${verb} ${result.path}\n  harness: ${result.name} (${result.scope} scope)\n`,
  );
  if (result.followUp) {
    process.stdout.write(`\nNext steps:\n${result.followUp}\n`);
  }
};
