import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { MANUAL } from "./instructions.js";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  editJsonEntry,
  editJsoncEntry,
  upsertMarkdownBlock,
  upsertTomlBlock,
  upsertYamlListEntry,
  upsertYamlListString,
  writeOwnedFile,
} from "./config-edit.js";

/**
 * Per-harness installer. `npx @origozero/zeromind install <harness>`
 * runs every step needed to make ZeroMind feel native in <harness> —
 * MCP server registration into that harness's config, agent instructions
 * into that harness's discovery path, plus any auxiliary setup. Each
 * step is independent and idempotent. Where the harness has a built-in
 * CLI subcommand for MCP registration (Codex, Goose) we shell out to it
 * and fall back to a direct config edit if it isn't on PATH.
 *
 * Steps that require user UI (JetBrains AI MCP picker, Amp settings UI)
 * are emitted as Manual steps with copy-paste instructions printed at the
 * end — those harnesses don't expose a programmatic config path.
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

type StepStatus = "written" | "updated" | "exists" | "manual" | "skipped";

export type StepResult = {
  label: string;
  status: StepStatus;
  /** Path that was touched, when applicable. */
  path?: string;
  /** Free-form note printed under the step (next-action hint for manual
   *  steps, fallback explanation, etc.). */
  note?: string;
};

type Ctx = {
  cwd: string;
  scope: Scope;
  force: boolean;
};

type Step = {
  label: string;
  run: (ctx: Ctx) => StepResult | Promise<StepResult>;
};

type HarnessSpec = {
  name: string;
  channel: string;
  defaultScope: Scope;
  scopes: Scope[];
  steps: Step[];
};

// ─── Helpers ────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");

const expand = (p: string): string =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const isOnPath = (cmd: string): boolean => {
  try {
    execFileSync(platform() === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const tryShell = (
  cmd: string,
  args: string[],
): { ok: true } | { ok: false; reason: string } => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
};

const SERVER_SPEC = {
  command: "npx",
  args: ["-y", "@origozero/zeromind"],
};

const ideEnv = (ide: string): Record<string, string> => ({
  ZEROMIND_IDE_NAME: ide,
});

const loadSkillFile = (skillDir: string): string => {
  const p = join(PKG_ROOT, "skills", skillDir, "SKILL.md");
  if (!existsSync(p)) {
    throw new Error(
      `skill source not found at ${p} (the published npm package should include skills/; if it doesn't, file an issue)`,
    );
  }
  return readFileSync(p, "utf8");
};

const SKILL_FRONTMATTER = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n`;

const ZM_SKILL_DESCRIPTION =
  "ZeroMind is a shared library of published worlds + assets and a 3D engine you drive remotely. Check ZeroMind first before building from scratch; install with `zeromind.install`; iterate in the connected world with `execute`/`capture`. Activate for any 'make me a X' / 'add a Y' Zero engine request.";

const newSkill = (manual: string): string =>
  SKILL_FRONTMATTER("zeromind", ZM_SKILL_DESCRIPTION) + manual;

const cursorMdc = (manual: string): string =>
  `---\ndescription: ${ZM_SKILL_DESCRIPTION}\nalwaysApply: false\n---\n\n${manual}`;

// ─── Reusable step factories ────────────────────────────────────────────

const writeFileStep = (
  label: string,
  pathBuilder: (ctx: Ctx) => string,
  body: () => string,
): Step => ({
  label,
  run: (ctx) => {
    const path = pathBuilder(ctx);
    const status = writeOwnedFile(path, body(), ctx.force);
    return { label, status, path };
  },
});

const upsertBlockStep = (
  label: string,
  pathBuilder: (ctx: Ctx) => string,
  body: () => string,
): Step => ({
  label,
  run: (ctx) => {
    const path = pathBuilder(ctx);
    const status = upsertMarkdownBlock(path, body());
    return { label, status, path };
  },
});

const editJsonMcpServerStep = (
  label: string,
  pathBuilder: (ctx: Ctx) => string,
  ideName: string,
  parentKey = "mcpServers",
): Step => ({
  label,
  run: (ctx) => {
    const path = pathBuilder(ctx);
    const status = editJsonEntry(path, parentKey, "zeromind", {
      ...SERVER_SPEC,
      env: ideEnv(ideName),
    });
    return { label, status, path };
  },
});

const editJsoncMcpServerStep = (
  label: string,
  pathBuilder: (ctx: Ctx) => string,
  parentPath: string[],
  ideName: string,
  shape: "command-args" | "zed-context" | "opencode" = "command-args",
): Step => ({
  label,
  run: async (ctx) => {
    const path = pathBuilder(ctx);
    let entry: unknown;
    if (shape === "zed-context") {
      entry = {
        command: {
          path: SERVER_SPEC.command,
          args: SERVER_SPEC.args,
          env: ideEnv(ideName),
        },
      };
    } else if (shape === "opencode") {
      entry = {
        type: "local",
        command: [SERVER_SPEC.command, ...SERVER_SPEC.args],
        environment: ideEnv(ideName),
        enabled: true,
      };
    } else {
      entry = { ...SERVER_SPEC, env: ideEnv(ideName) };
    }
    const status = await editJsoncEntry(path, parentPath, "zeromind", entry);
    return { label, status, path };
  },
});

// ─── Per-harness step lists ─────────────────────────────────────────────

const claudeSkillPath = (skill: string) => (ctx: Ctx): string => {
  const base =
    ctx.scope === "global"
      ? expand(`~/.claude/skills/${skill}/SKILL.md`)
      : join(ctx.cwd, `.claude/skills/${skill}/SKILL.md`);
  return base;
};

const HARNESSES: Record<Harness, HarnessSpec> = {
  claude: {
    name: "Claude Code",
    channel:
      "skills (`.claude/skills/<name>/SKILL.md`) + MCP server in `~/.claude/settings.json`",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "skill: zeromind-getting-started",
        claudeSkillPath("zeromind-getting-started"),
        () => loadSkillFile("zeromind-getting-started"),
      ),
      writeFileStep(
        "skill: zeromind-library",
        claudeSkillPath("zeromind-library"),
        () => loadSkillFile("zeromind-library"),
      ),
      editJsonMcpServerStep(
        "MCP server in ~/.claude/settings.json",
        () => expand("~/.claude/settings.json"),
        "claude-code",
      ),
      {
        label: "marketplace plugin (one-shot equivalent)",
        run: () => ({
          label: "marketplace plugin (one-shot equivalent)",
          status: "manual",
          note: "Prefer the marketplace install from inside Claude Code:\n  /plugin marketplace add OrigoZero/zeromind-plugin\n  /plugin install zeromind\nIt bundles the skills + MCP server in a single command and survives upgrades automatically.",
        }),
      },
    ],
  },

  cursor: {
    name: "Cursor",
    channel:
      "`.cursor/rules/<name>.mdc` (rules) + `~/.cursor/mcp.json` (MCP server)",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "rule: .cursor/rules/zeromind.mdc",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.cursor/rules/zeromind.mdc")
            : join(ctx.cwd, ".cursor/rules/zeromind.mdc"),
        () => cursorMdc(MANUAL),
      ),
      editJsonMcpServerStep(
        "MCP server in ~/.cursor/mcp.json",
        () => expand("~/.cursor/mcp.json"),
        "cursor",
      ),
    ],
  },

  codex: {
    name: "Codex CLI",
    channel:
      "AGENTS.md + `~/.codex/config.toml` (via `codex mcp add`, with TOML fallback)",
    defaultScope: "global",
    scopes: ["project", "global"],
    steps: [
      {
        label: "MCP server: `codex mcp add zeromind`",
        run: () => {
          if (isOnPath("codex")) {
            const r = tryShell("codex", [
              "mcp",
              "add",
              "zeromind",
              "--",
              SERVER_SPEC.command,
              ...SERVER_SPEC.args,
            ]);
            if (r.ok) {
              return {
                label: "MCP server: `codex mcp add zeromind`",
                status: "updated",
                note: "Ran `codex mcp add` to register the server.",
              };
            }
          }
          // Fallback — write the TOML block directly. Codex reads it on next launch.
          const path = expand("~/.codex/config.toml");
          const body = `[mcp_servers.zeromind]\ncommand = "npx"\nargs = ["-y", "@origozero/zeromind"]\n\n[mcp_servers.zeromind.env]\nZEROMIND_IDE_NAME = "codex"\n`;
          const status = upsertTomlBlock(path, body);
          return {
            label: "MCP server in ~/.codex/config.toml",
            status,
            path,
            note: "`codex` CLI not on PATH — wrote the [mcp_servers.zeromind] block directly. Run the install again after installing the Codex CLI to use `codex mcp add`.",
          };
        },
      },
      upsertBlockStep(
        "AGENTS.md",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.codex/AGENTS.md")
            : join(ctx.cwd, "AGENTS.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
    ],
  },

  gemini: {
    name: "Gemini CLI",
    channel:
      "GEMINI.md + `~/.gemini/settings.json` (MCP server). Also ships a Gemini extension bundle under `dist-publishing/gemini-extension/` for harness-native distribution.",
    defaultScope: "global",
    scopes: ["project", "global"],
    steps: [
      editJsonMcpServerStep(
        "MCP server in ~/.gemini/settings.json",
        () => expand("~/.gemini/settings.json"),
        "gemini-cli",
      ),
      upsertBlockStep(
        "GEMINI.md",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.gemini/GEMINI.md")
            : join(ctx.cwd, "GEMINI.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
    ],
  },

  opencode: {
    name: "OpenCode",
    channel:
      "`.opencode/skills/<name>/SKILL.md` + `opencode.jsonc` (MCP server)",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "skill: zeromind",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.config/opencode/skills/zeromind/SKILL.md")
            : join(ctx.cwd, ".opencode/skills/zeromind/SKILL.md"),
        () => newSkill(MANUAL),
      ),
      editJsoncMcpServerStep(
        "MCP server in opencode.jsonc",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.config/opencode/opencode.jsonc")
            : join(ctx.cwd, "opencode.jsonc"),
        ["mcp"],
        "opencode",
        "opencode",
      ),
    ],
  },

  cline: {
    name: "Cline",
    channel:
      "`.clinerules/zeromind.md` + Cline's `cline_mcp_settings.json`. Also ships a Cline MCP Marketplace listing under `dist-publishing/cline-marketplace/zeromind.json`.",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      writeFileStep(
        "rule: .clinerules/zeromind.md",
        (ctx) => join(ctx.cwd, ".clinerules/zeromind.md"),
        () => MANUAL,
      ),
      {
        label: "MCP server: Cline settings UI",
        run: () => ({
          label: "MCP server: Cline settings UI",
          status: "manual",
          note: "Open Cline's MCP Servers UI (Command Palette → 'Cline: MCP Servers') and add:\n  { \"command\": \"npx\", \"args\": [\"-y\", \"@origozero/zeromind\"], \"env\": { \"ZEROMIND_IDE_NAME\": \"cline\" } }\nA Cline MCP Marketplace listing for one-click install is in dist-publishing/cline-marketplace/.",
        }),
      },
    ],
  },

  continue: {
    name: "Continue",
    channel:
      "`.continue/rules/zeromind.md` + `~/.continue/config.yaml` (MCP server)",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "rule: .continue/rules/zeromind.md",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.continue/rules/zeromind.md")
            : join(ctx.cwd, ".continue/rules/zeromind.md"),
        () => MANUAL,
      ),
      {
        label: "MCP server in ~/.continue/config.yaml",
        run: async () => {
          const path = expand("~/.continue/config.yaml");
          const status = await upsertYamlListEntry(path, "mcpServers", {
            name: "zeromind",
            command: SERVER_SPEC.command,
            args: SERVER_SPEC.args,
            env: ideEnv("continue"),
          });
          return { label: "MCP server in ~/.continue/config.yaml", status, path };
        },
      },
    ],
  },

  windsurf: {
    name: "Windsurf",
    channel:
      "`AGENTS.md` + `~/.codeium/windsurf/mcp_config.json` (MCP server)",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "AGENTS.md",
        (ctx) => join(ctx.cwd, "AGENTS.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      editJsonMcpServerStep(
        "MCP server in ~/.codeium/windsurf/mcp_config.json",
        () => expand("~/.codeium/windsurf/mcp_config.json"),
        "windsurf",
      ),
    ],
  },

  zed: {
    name: "Zed",
    channel:
      "`.claude/skills/<name>/SKILL.md` + `~/.config/zed/settings.json` (context_servers)",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "skill: zeromind",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.claude/skills/zeromind/SKILL.md")
            : join(ctx.cwd, ".claude/skills/zeromind/SKILL.md"),
        () => newSkill(MANUAL),
      ),
      editJsoncMcpServerStep(
        "MCP server in ~/.config/zed/settings.json",
        () => expand("~/.config/zed/settings.json"),
        ["context_servers"],
        "zed",
        "zed-context",
      ),
    ],
  },

  openclaw: {
    name: "openClaw",
    channel:
      "skills (`skills/<name>/SKILL.md` or `~/.openclaw/skills/<name>/SKILL.md`). Also ships a ClawHub publish package under `dist-publishing/clawhub/`.",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      {
        label: "skill via `openclaw skills install`",
        run: (ctx) => {
          if (isOnPath("openclaw")) {
            const r = tryShell("openclaw", [
              "skills",
              "install",
              "@origozero/zeromind",
              ...(ctx.scope === "global" ? ["--global"] : []),
            ]);
            if (r.ok) {
              return {
                label: "skill via `openclaw skills install`",
                status: "updated",
                note: "Ran `openclaw skills install`.",
              };
            }
          }
          // Fallback — drop the SKILL.md ourselves.
          const path =
            ctx.scope === "global"
              ? expand("~/.openclaw/skills/zeromind/SKILL.md")
              : join(ctx.cwd, "skills/zeromind/SKILL.md");
          const status = writeOwnedFile(path, newSkill(MANUAL), ctx.force);
          return {
            label: "skill: zeromind",
            status,
            path,
            note: "`openclaw` CLI not on PATH — dropped the SKILL.md directly. Install the openclaw CLI to use `openclaw skills install` (and ClawHub for upgrades) in future.",
          };
        },
      },
    ],
  },

  aider: {
    name: "Aider",
    channel:
      "`CONVENTIONS.md` + `.aider.conf.yml` (`read:` entry). Aider has no native MCP — instructions-only.",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "CONVENTIONS.md",
        (ctx) => join(ctx.cwd, "CONVENTIONS.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      {
        label: "register in .aider.conf.yml (`read:`)",
        run: async (ctx) => {
          const path = join(ctx.cwd, ".aider.conf.yml");
          const status = await upsertYamlListString(path, "read", "CONVENTIONS.md");
          return {
            label: "register in .aider.conf.yml (`read:`)",
            status,
            path,
            note: "Aider includes every line of CONVENTIONS.md in every request. If the file grows past ~200 lines, trim the ZeroMind block to keep latency reasonable.",
          };
        },
      },
    ],
  },

  copilot: {
    name: "GitHub Copilot",
    channel:
      "`.github/copilot-instructions.md` + VS Code Copilot agent mode MCP config (per-user `settings.json`)",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "copilot-instructions.md",
        (ctx) => join(ctx.cwd, ".github/copilot-instructions.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      {
        label: "MCP server in VS Code user settings.json",
        run: async () => {
          const home = homedir();
          const candidates =
            platform() === "win32"
              ? [
                  join(process.env.APPDATA ?? join(home, "AppData/Roaming"), "Code/User/settings.json"),
                ]
              : platform() === "darwin"
                ? [join(home, "Library/Application Support/Code/User/settings.json")]
                : [join(home, ".config/Code/User/settings.json")];
          const path = candidates[0];
          const status = await editJsoncEntry(
            path,
            ["github.copilot.advanced", "mcp", "servers"],
            "zeromind",
            { ...SERVER_SPEC, env: ideEnv("copilot") },
          );
          return {
            label: "MCP server in VS Code user settings.json",
            status,
            path,
            note: "VS Code Copilot agent mode reads MCP servers from this JSONC path. If you use a Code variant (Insiders / Cursor / VSCodium) the path differs; pass --copilot-settings to override, or wire it through the Copilot settings UI.",
          };
        },
      },
    ],
  },

  goose: {
    name: "Block Goose",
    channel:
      "`~/.config/goose/.goosehints` + Goose MCP server (via `goose mcp add`)",
    defaultScope: "global",
    scopes: ["global"],
    steps: [
      {
        label: "MCP server: `goose mcp add zeromind`",
        run: () => {
          if (isOnPath("goose")) {
            const r = tryShell("goose", [
              "mcp",
              "add",
              "zeromind",
              "--",
              SERVER_SPEC.command,
              ...SERVER_SPEC.args,
            ]);
            if (r.ok) {
              return {
                label: "MCP server: `goose mcp add zeromind`",
                status: "updated",
                note: "Ran `goose mcp add` to register the server.",
              };
            }
          }
          return {
            label: "MCP server: `goose mcp add zeromind`",
            status: "manual",
            note: "`goose` CLI not on PATH. After installing Goose, run:\n  goose mcp add zeromind -- npx -y @origozero/zeromind\nOr register via the Goose desktop UI's MCP servers page.",
          };
        },
      },
      upsertBlockStep(
        ".goosehints",
        () => expand("~/.config/goose/.goosehints"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
    ],
  },

  junie: {
    name: "JetBrains Junie",
    channel: "`AGENTS.md` + IDE-level MCP picker (manual)",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "AGENTS.md",
        (ctx) => join(ctx.cwd, "AGENTS.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      {
        label: "MCP server: JetBrains AI MCP picker",
        run: () => ({
          label: "MCP server: JetBrains AI MCP picker",
          status: "manual",
          note: "Open your JetBrains IDE → Settings → Tools → AI Assistant → MCP Servers → Add:\n  command: npx\n  args: -y @origozero/zeromind\n  env: ZEROMIND_IDE_NAME=junie\nJetBrains doesn't expose a programmatic config path for this.",
        }),
      },
    ],
  },

  amp: {
    name: "Sourcegraph Amp",
    channel: "`AGENT.md` + Amp settings UI (manual)",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "AGENT.md",
        (ctx) => join(ctx.cwd, "AGENT.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      {
        label: "MCP server: Amp settings UI",
        run: () => ({
          label: "MCP server: Amp settings UI",
          status: "manual",
          note: "Add through Amp's MCP servers settings page:\n  command: npx\n  args: -y @origozero/zeromind\n  env: ZEROMIND_IDE_NAME=amp",
        }),
      },
    ],
  },
};

// ─── Public API + CLI driver ───────────────────────────────────────────

export type InstallReport = {
  harness: Harness;
  name: string;
  scope: Scope;
  channel: string;
  steps: StepResult[];
};

export const installHarness = async (opts: {
  harness: Harness;
  scope?: Scope;
  cwd?: string;
  force?: boolean;
}): Promise<InstallReport> => {
  const spec = HARNESSES[opts.harness];
  if (!spec) throw new Error(`unknown harness: ${opts.harness}`);
  const scope = opts.scope ?? spec.defaultScope;
  if (!spec.scopes.includes(scope)) {
    throw new Error(
      `${spec.name}: ${scope} scope not supported (supported: ${spec.scopes.join(", ")})`,
    );
  }
  const ctx: Ctx = { cwd: opts.cwd ?? process.cwd(), scope, force: opts.force ?? false };
  const steps: StepResult[] = [];
  for (const step of spec.steps) {
    try {
      steps.push(await step.run(ctx));
    } catch (e) {
      steps.push({
        label: step.label,
        status: "skipped",
        note: `failed: ${(e as Error).message}`,
      });
    }
  }
  return {
    harness: opts.harness,
    name: spec.name,
    scope,
    channel: spec.channel,
    steps,
  };
};

export const listHarnesses = (): {
  harness: Harness;
  name: string;
  channel: string;
  scopes: Scope[];
  defaultScope: Scope;
  stepCount: number;
}[] =>
  (Object.keys(HARNESSES) as Harness[]).map((h) => {
    const s = HARNESSES[h];
    return {
      harness: h,
      name: s.name,
      channel: s.channel,
      scopes: s.scopes,
      defaultScope: s.defaultScope,
      stepCount: s.steps.length,
    };
  });

const STATUS_GLYPH: Record<StepStatus, string> = {
  written: "+",
  updated: "~",
  exists: "=",
  manual: "?",
  skipped: "x",
};

const HELP = `zeromind install <harness> [--global | --project] [--force] [--cwd <p>]
zeromind install --list

Native end-to-end install per harness. The command runs every step that
harness needs — MCP server registration into the harness's own config,
agent instructions into the harness's discovery path, plus any auxiliary
setup. Where the harness has a CLI subcommand for MCP registration
(\`codex mcp add\`, \`goose mcp add\`, \`openclaw skills install\`) we shell
out to it; otherwise we edit the config file directly. Steps that require
a harness UI (JetBrains AI MCP picker, Amp settings, Cline MCP Servers UI)
are printed as manual instructions at the end.

Harnesses:
${listHarnesses()
  .map((h) => `  ${h.harness.padEnd(10)} ${h.name}  →  ${h.channel}`)
  .join("\n")}

Flags:
  --global   write to user-global config (e.g. ~/.codex/AGENTS.md)
  --project  write to the current project (default for most harnesses)
  --force    overwrite an existing owned file (skills, rule files)
  --cwd <p>  install relative to <p> instead of $PWD
`;

export const runInstallCli = async (argv: string[]): Promise<void> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--list" || argv[0] === "list") {
    for (const h of listHarnesses()) {
      process.stdout.write(
        `${h.harness.padEnd(10)} ${h.name}\n  channel: ${h.channel}\n  scopes:  ${h.scopes.join(", ")} (default: ${h.defaultScope})\n  steps:   ${h.stepCount}\n\n`,
      );
    }
    return;
  }
  const harness = argv[0] as Harness;
  if (!(harness in HARNESSES)) {
    process.stderr.write(
      `unknown harness '${harness}'. Run \`zeromind install --list\` for the supported list.\n`,
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
      process.stderr.write(`unknown flag: ${a}\n\n${HELP}`);
      process.exit(1);
    }
  }
  const report = await installHarness({ harness, scope, cwd, force });
  process.stdout.write(
    `\nzeromind: installing into ${report.name} (${report.scope} scope)\n  channel: ${report.channel}\n\n`,
  );
  const manualNotes: string[] = [];
  for (const s of report.steps) {
    process.stdout.write(`  [${STATUS_GLYPH[s.status]}] ${s.label}`);
    if (s.path) process.stdout.write(`  →  ${s.path}`);
    process.stdout.write("\n");
    if (s.note && (s.status === "manual" || s.status === "skipped")) {
      manualNotes.push(`\n${s.label}:\n${s.note}`);
    }
  }
  process.stdout.write(
    `\nLegend: + written  ~ updated  = exists (use --force)  ? manual step  x skipped\n`,
  );
  if (manualNotes.length > 0) {
    process.stdout.write(`\nManual follow-ups:${manualNotes.join("\n")}\n`);
  }
};

export const blockMarkers = {
  begin: BLOCK_BEGIN,
  end: BLOCK_END,
};
