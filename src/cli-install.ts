import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  copyPluginBundle,
  editJsonEntry,
  editJsoncEntry,
  upsertMarkdownBlock,
  upsertTomlBlock,
  upsertYamlListEntry,
  upsertYamlListString,
  upsertYamlMapEntry,
  writeOwnedFile,
} from "./config-edit.js";
import { writeClaudeEnv } from "./cli-link.js";
import { installSecret, loadCache } from "./config.js";
import {
  remoteServer,
  remoteUrl,
  SECRET_ENV,
  SERVER_KEY,
  type RemoteServer,
} from "./server-spec.js";

/**
 * Per-harness installer. `zeromind install <harness>` runs every step
 * needed to make ZeroMind feel native in <harness> — the remote `/mcp`
 * server into that harness's own config, agent instructions into that
 * harness's discovery path, plus any auxiliary setup. Each step is
 * independent and idempotent.
 *
 * Every harness points at the same address, `https://origozero.ai/mcp`,
 * and identifies itself with `X-ZM-Harness`. What differs per harness is
 * the shape its config file wants that in, and whether it can expand an
 * environment variable in the file (Claude Code can, so its config holds
 * `${ZEROMIND_INSTALL_SECRET}`; the rest hold the machine's own install
 * secret, in a file readable only by its owner).
 *
 * Steps that require a harness UI, or a harness whose MCP entry point is
 * unconfirmed (openClaw, Aider), are emitted as Manual steps carrying the
 * URL and the headers, printed at the end.
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
  | "amp"
  | "hermes";

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

const tryRead = (rel: string): string | undefined => {
  try {
    return readFileSync(join(PKG_ROOT, rel), "utf8");
  } catch {
    return undefined;
  }
};

const MANUAL_FALLBACK = `ZeroMind: a shared content library + a 3D engine you drive remotely. Run \`zeromind.search\` BEFORE writing anything for "make me a X" requests — installing existing published content beats building from scratch. Then \`world.connect\`, \`zeromind.install\`, iterate with \`execute\`/\`capture\`, publish from the engine bash with \`zm add . && zm commit -m '...' && zm push\`. Call \`zeromind.help\` for the full guides.`;

/**
 * Canonical condensed operating manual, single source for the body of every
 * harness-specific artifact `zeromind install <harness>` writes (AGENTS.md /
 * GEMINI.md / SKILL.md / .cursor/rules/zeromind.mdc / .clinerules /
 * CONVENTIONS.md / …).
 */
const MANUAL: string = tryRead(join("templates", "manual.md")) ?? MANUAL_FALLBACK;

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

/** What a command printed, or undefined if it could not be run. */
const shellOutput = (cmd: string, args: string[]): string | undefined => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return undefined;
  }
};

/** The literal descriptor for harnesses that read no environment in their config. */
const literalServer = (harness: string): RemoteServer => {
  const secret = installSecret(loadCache());
  if (!secret) throw new Error("this machine is not linked; run `zeromind link` first");
  return remoteServer(harness, secret);
};

/** The expanding descriptor for harnesses that interpolate env in their config. */
const expandingServer = (harness: string, expansion: string): RemoteServer =>
  remoteServer(harness, expansion);

/** The form for harnesses whose HTTP entry carries no `type` discriminator. */
const urlHeaders = (s: RemoteServer): { url: string; headers: Record<string, string> } => ({
  url: s.url,
  headers: s.headers,
});

/** A config file now holding the install secret belongs to its owner alone. */
const restrictToOwner = (path: string): void => {
  if (platform() === "win32") return;
  try {
    chmodSync(path, 0o600);
  } catch {
    // The harness may hold the file open; the entry is written either way.
  }
};

/** What a manual step tells the user to add, wherever their harness keeps MCP servers. */
const manualEntry = (harness: string): string =>
  `  url: ${remoteUrl()}\n  header Authorization: Bearer <this machine's install_secret from ~/.config/zero/session.json>\n  header X-ZM-Harness: ${harness}`;

/**
 * `codex mcp add` takes `--url` for a streamable HTTP server. It can stand
 * in for the config.toml edit only when it can also carry the two headers
 * the server is reached with, which the CLI advertises as `--header`.
 */
const codexAddCarriesHeaders = (): boolean => {
  const help = shellOutput("codex", ["mcp", "add", "--help"]);
  return help !== undefined && help.includes("--url") && help.includes("--header");
};

/** VS Code's per-user config directory, home to both Copilot's and Cline's settings. */
const vscodeUserDir = (): string => {
  const home = homedir();
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData/Roaming"), "Code/User");
  }
  if (platform() === "darwin") return join(home, "Library/Application Support/Code/User");
  return join(home, ".config/Code/User");
};

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
  entry: () => unknown,
  parentKey = "mcpServers",
): Step => ({
  label,
  run: (ctx) => {
    const path = pathBuilder(ctx);
    const status = editJsonEntry(path, parentKey, SERVER_KEY, entry());
    restrictToOwner(path);
    return { label, status, path };
  },
});

const editJsoncMcpServerStep = (
  label: string,
  pathBuilder: (ctx: Ctx) => string,
  parentPath: string[],
  entry: () => unknown,
): Step => ({
  label,
  run: async (ctx) => {
    const path = pathBuilder(ctx);
    const status = await editJsoncEntry(path, parentPath, SERVER_KEY, entry());
    restrictToOwner(path);
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
        // Claude Code expands `${VAR}` in an MCP entry's url and headers
        // from its own settings `env`, so its config never holds the
        // secret itself — the step below puts the value there.
        () => expandingServer("claude-code", `\${${SECRET_ENV}}`),
      ),
      {
        label: `${SECRET_ENV} in ~/.claude/settings.json`,
        run: () => {
          const secret = installSecret(loadCache());
          if (!secret) throw new Error("this machine is not linked; run `zeromind link` first");
          const path = expand("~/.claude/settings.json");
          const status = writeClaudeEnv(secret, path);
          restrictToOwner(path);
          return { label: `${SECRET_ENV} in ~/.claude/settings.json`, status, path };
        },
      },
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
      "Cursor 3.0 plugin (`.cursor-plugin/plugin.json` bundle in `~/.cursor/plugins/local/`) — bundles skills, the `zeromind.mdc` rule, and `mcp.json`. Manual fallback edits `~/.cursor/mcp.json` + writes a single rule file.",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      {
        // Cursor 3.0's actual native channel is its plugin system —
        // bundles skills, rules, commands, hooks, and an mcp.json under
        // a `.cursor-plugin/plugin.json` manifest. We ship a
        // ready-to-install bundle and copy it into the user's local
        // plugins dir, where Cursor auto-discovers it on startup.
        label: "Cursor plugin: copy bundle to ~/.cursor/plugins/local/",
        run: (ctx) => {
          const src = join(PKG_ROOT, "dist-publishing", "cursor-plugin");
          if (!existsSync(src)) {
            return {
              label: "Cursor plugin: copy bundle to ~/.cursor/plugins/local/",
              status: "skipped",
              note: `Plugin bundle missing at ${src}. The published npm package should include dist-publishing/.`,
            };
          }
          const dest = expand("~/.cursor/plugins/local/zeromind");
          const status = copyPluginBundle(src, dest, ctx.force);
          return {
            label: "Cursor plugin: copy bundle to ~/.cursor/plugins/local/",
            status,
            path: dest,
            note:
              status === "exists"
                ? "Plugin already at this path — re-run with --force to refresh."
                : "Restart Cursor; the plugin auto-loads on startup. Once the marketplace listing is live, users can also install via cursor.com/marketplace one-click.",
          };
        },
      },
      {
        // Manual fallback: a single .cursor/rules/*.mdc + mcp.json edit
        // for environments where the plugin bundle isn't picked up.
        label: "Manual fallback: rule + ~/.cursor/mcp.json",
        run: (ctx) => {
          const rulePath =
            ctx.scope === "global"
              ? expand("~/.cursor/rules/zeromind.mdc")
              : join(ctx.cwd, ".cursor/rules/zeromind.mdc");
          writeOwnedFile(rulePath, cursorMdc(MANUAL), ctx.force);
          const mcpPath = expand("~/.cursor/mcp.json");
          // Cursor's HTTP form is the bare `url` + `headers` pair.
          const status = editJsonEntry(
            mcpPath,
            "mcpServers",
            SERVER_KEY,
            urlHeaders(literalServer("cursor")),
          );
          restrictToOwner(mcpPath);
          return {
            label: "Manual fallback: rule + ~/.cursor/mcp.json",
            status,
            path: mcpPath,
          };
        },
      },
    ],
  },

  codex: {
    name: "Codex CLI",
    channel:
      "Codex plugin (`.codex-plugin/plugin.json` bundle in personal marketplace) — bundles both skills and the MCP server. Manual fallback writes `~/.codex/config.toml` + `~/.codex/AGENTS.md`.",
    defaultScope: "global",
    scopes: ["project", "global"],
    steps: [
      {
        // Codex's actual native channel is its plugin system — bundles
        // skills + MCP + apps in a manifest at `.codex-plugin/plugin.json`.
        // We ship a ready-to-install bundle at dist-publishing/codex-plugin
        // and copy it into the user's personal Codex marketplace dir.
        label: "Codex plugin: copy bundle to personal marketplace",
        run: (ctx) => {
          const src = join(PKG_ROOT, "dist-publishing", "codex-plugin");
          if (!existsSync(src)) {
            return {
              label: "Codex plugin: copy bundle to personal marketplace",
              status: "skipped",
              note: `Plugin bundle missing at ${src}. The published npm package should include dist-publishing/.`,
            };
          }
          const dest = expand("~/.codex/marketplaces/personal/zeromind");
          const status = copyPluginBundle(src, dest, ctx.force);
          return {
            label: "Codex plugin: copy bundle to personal marketplace",
            status,
            path: dest,
            note:
              status === "exists"
                ? "Plugin already at this path — re-run with --force to refresh."
                : "Open Codex's `/plugins` UI to enable the zeromind plugin (the bundle is now visible in your personal marketplace).",
          };
        },
      },
      {
        // Manual-fallback path: write the MCP server entry directly to
        // ~/.codex/config.toml in case the user isn't using the plugin
        // browser. Belt-and-suspenders — Codex reads BOTH plugin
        // manifests AND config.toml entries.
        label: "Manual fallback: MCP server in ~/.codex/config.toml",
        run: () => {
          const s = literalServer("codex");
          const path = expand("~/.codex/config.toml");
          if (isOnPath("codex") && codexAddCarriesHeaders()) {
            const r = tryShell("codex", [
              "mcp",
              "add",
              SERVER_KEY,
              "--url",
              s.url,
              ...Object.entries(s.headers).flatMap(([k, v]) => ["--header", `${k}: ${v}`]),
            ]);
            if (r.ok) {
              restrictToOwner(path);
              return {
                label: "Manual fallback: `codex mcp add zeromind --url`",
                status: "updated",
                path,
                note: "Registered through the Codex CLI, which writes this file.",
              };
            }
          }
          const headers = Object.entries(s.headers)
            .map(([k, v]) => `"${k}" = "${v}"`)
            .join(", ");
          const body = `[mcp_servers.zeromind]\nurl = "${s.url}"\nhttp_headers = { ${headers} }\n`;
          const status = upsertTomlBlock(path, body);
          restrictToOwner(path);
          return {
            label: "Manual fallback: MCP server in ~/.codex/config.toml",
            status,
            path,
          };
        },
      },
      upsertBlockStep(
        "AGENTS.md (project context, complementary to the plugin)",
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
      "Gemini extension (`gemini-extension.json` bundles MCP server + context file in `~/.gemini/extensions/<name>/`). Falls back to direct edit of `~/.gemini/settings.json` + `~/.gemini/GEMINI.md`.",
    defaultScope: "global",
    scopes: ["project", "global"],
    steps: [
      {
        // Gemini CLI's actual native channel is extensions — a
        // gemini-extension.json directory under ~/.gemini/extensions/
        // that bundles MCP server + context file. We ship a
        // ready-to-install one in dist-publishing/gemini-extension/.
        label: "Gemini extension: copy bundle to ~/.gemini/extensions/",
        run: (ctx) => {
          const src = join(
            PKG_ROOT,
            "dist-publishing",
            "gemini-extension",
            "zeromind",
          );
          if (!existsSync(src)) {
            return {
              label: "Gemini extension: copy bundle to ~/.gemini/extensions/",
              status: "skipped",
              note: `Extension bundle missing at ${src}.`,
            };
          }
          const dest = expand("~/.gemini/extensions/zeromind");
          const status = copyPluginBundle(src, dest, ctx.force);
          return {
            label: "Gemini extension: copy bundle to ~/.gemini/extensions/",
            status,
            path: dest,
            note:
              status === "exists"
                ? "Extension already at this path — re-run with --force to refresh."
                : "Restart Gemini CLI; the extension is auto-discovered. You can also `gemini extensions install <git-url>` to track updates from the repo.",
          };
        },
      },
      {
        // Manual fallback for users not on the extensions-capable
        // version of Gemini CLI.
        label: "Manual fallback: MCP server in ~/.gemini/settings.json",
        run: () => {
          const path = expand("~/.gemini/settings.json");
          // Gemini CLI names a streamable-HTTP server's address `httpUrl`.
          const s = literalServer("gemini-cli");
          const status = editJsonEntry(path, "mcpServers", SERVER_KEY, {
            httpUrl: s.url,
            headers: s.headers,
          });
          restrictToOwner(path);
          return {
            label: "Manual fallback: MCP server in ~/.gemini/settings.json",
            status,
            path,
          };
        },
      },
      upsertBlockStep(
        "GEMINI.md (project context, complementary to the extension)",
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
        // OpenCode calls an HTTP server `remote`.
        () => {
          const s = literalServer("opencode");
          return { type: "remote", url: s.url, headers: s.headers, enabled: true };
        },
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
      editJsonMcpServerStep(
        "MCP server in Cline's cline_mcp_settings.json",
        () =>
          join(
            vscodeUserDir(),
            "globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
          ),
        () => {
          const s = literalServer("cline");
          return {
            type: "streamableHttp",
            url: s.url,
            headers: s.headers,
            disabled: false,
            autoApprove: [],
          };
        },
      ),
      {
        label: "MCP server: Cline settings UI (JetBrains, or a VS Code variant)",
        run: () => ({
          label: "MCP server: Cline settings UI (JetBrains, or a VS Code variant)",
          status: "manual",
          note: `The step above writes VS Code's copy of cline_mcp_settings.json. On JetBrains, or a Code variant that stores it elsewhere, open Cline's MCP Servers UI (Command Palette → 'Cline: MCP Servers' → 'Configure MCP Servers') and add a streamableHttp server:\n${manualEntry("cline")}\nA Cline MCP Marketplace listing for one-click install is in dist-publishing/cline-marketplace/.`,
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
          // Continue's HTTP transport is `streamable-http`, and headers
          // ride in `requestOptions`.
          const s = literalServer("continue");
          const status = await upsertYamlListEntry(path, "mcpServers", {
            name: SERVER_KEY,
            type: "streamable-http",
            url: s.url,
            requestOptions: { headers: s.headers },
          });
          restrictToOwner(path);
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
        // Windsurf names a remote server's address `serverUrl`.
        () => {
          const s = literalServer("windsurf");
          return { serverUrl: s.url, headers: s.headers };
        },
      ),
    ],
  },

  zed: {
    name: "Zed",
    channel:
      "Zed extension (`extension.toml` with `context_servers.zeromind`) + agent skill at `.claude/skills/zeromind/SKILL.md` (Zed reads the same path as Claude Code). Manual fallback edits `~/.config/zed/settings.json` directly.",
    defaultScope: "project",
    scopes: ["project", "global"],
    steps: [
      writeFileStep(
        "skill: .claude/skills/zeromind/SKILL.md (Zed auto-reads it)",
        (ctx) =>
          ctx.scope === "global"
            ? expand("~/.claude/skills/zeromind/SKILL.md")
            : join(ctx.cwd, ".claude/skills/zeromind/SKILL.md"),
        () => newSkill(MANUAL),
      ),
      {
        // Zed's actual native channel for MCP is the extension registry
        // at zed.dev/extensions. We ship a ready-to-install extension
        // (TOML-only — no Rust/WASM build) and copy it into Zed's
        // dev-extensions location.
        label: "Zed extension: copy bundle to dev-extensions",
        run: (ctx) => {
          const src = join(PKG_ROOT, "dist-publishing", "zed-extension");
          if (!existsSync(src)) {
            return {
              label: "Zed extension: copy bundle to dev-extensions",
              status: "skipped",
              note: `Extension bundle missing at ${src}.`,
            };
          }
          const dest = expand("~/.local/share/zed/extensions/installed/zeromind");
          const status = copyPluginBundle(src, dest, ctx.force);
          return {
            label: "Zed extension: copy bundle to dev-extensions",
            status,
            path: dest,
            note:
              status === "exists"
                ? "Extension already at this path — re-run with --force to refresh."
                : "Open Zed → Command Palette → 'zed: extensions' to confirm the ZeroMind context_server is wired up.",
          };
        },
      },
      {
        // Manual fallback: edit settings.json directly in case the
        // dev-extensions path isn't where this Zed install looks.
        label: "Manual fallback: MCP server in ~/.config/zed/settings.json",
        run: async () => {
          const path = expand("~/.config/zed/settings.json");
          const status = await editJsoncEntry(
            path,
            ["context_servers"],
            SERVER_KEY,
            urlHeaders(literalServer("zed")),
          );
          restrictToOwner(path);
          return {
            label: "Manual fallback: MCP server in ~/.config/zed/settings.json",
            status,
            path,
          };
        },
      },
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
      {
        // openClaw's MCP entry point is unconfirmed — the skill is this
        // harness's primary channel. Whichever config its build reads,
        // the server it points at is the same one.
        label: "MCP server: wherever openClaw reads MCP servers",
        run: () => ({
          label: "MCP server: wherever openClaw reads MCP servers",
          status: "manual",
          note: `openClaw's MCP config path is unconfirmed. If your build has one, add a streamable-HTTP server there:\n${manualEntry("openclaw")}\nThe ClawHub package in dist-publishing/clawhub/ carries the same entry with a \`\${${SECRET_ENV}}\` expansion.`,
        }),
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
      {
        // Aider takes MCP servers on the command line, and an Aider that
        // predates `--mcp-servers` errors on an unknown key in
        // `.aider.conf.yml` — so this one is the user's to add.
        label: "MCP server: `aider --mcp-servers`",
        run: () => ({
          label: "MCP server: `aider --mcp-servers`",
          status: "manual",
          note: `An Aider with MCP support takes the server as JSON on the command line:\n  aider --mcp-servers '{"mcpServers":{"zeromind":{"url":"${remoteUrl()}","headers":{"Authorization":"Bearer <this machine's install_secret from ~/.config/zero/session.json>","X-ZM-Harness":"aider"}}}}'\nWithout it, CONVENTIONS.md still reaches the agent; the zeromind.* tools do not.`,
        }),
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
          const path = join(vscodeUserDir(), "settings.json");
          const status = await editJsoncEntry(
            path,
            ["github.copilot.advanced", "mcp", "servers"],
            SERVER_KEY,
            literalServer("copilot"),
          );
          restrictToOwner(path);
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
      "Goose extension (declared in `~/.config/goose/config.yaml` under `extensions`) + `goose://extension?...` deeplink for one-click web install + `~/.config/goose/.goosehints`",
    defaultScope: "global",
    scopes: ["global"],
    steps: [
      {
        // Goose's actual native channel is the `extensions` config block
        // plus the `goose://extension?...` deeplink format. Try both.
        label: "Extension entry in ~/.config/goose/config.yaml",
        run: async () => {
          const path = expand("~/.config/goose/config.yaml");
          // Goose names a remote extension's address `uri`, under the
          // `streamable_http` type.
          const s = literalServer("goose");
          const status = await upsertYamlListEntry(path, "extensions", {
            name: SERVER_KEY,
            display_name: "ZeroMind",
            description:
              "ZeroMind — search/install published worlds + assets and drive the Zero engine in your browser.",
            enabled: true,
            type: "streamable_http",
            uri: s.url,
            headers: s.headers,
            env_keys: [],
            timeout: 300,
            bundled: false,
          });
          restrictToOwner(path);
          return {
            label: "Extension entry in ~/.config/goose/config.yaml",
            status,
            path,
          };
        },
      },
      {
        // One-click web install: `goose://extension?...` deeplink. Goose
        // honors these per their deeplink-generator docs. Print it for
        // sharing / docs / one-click flows.
        label: "Generate `goose://extension` deeplink (for one-click install)",
        run: () => {
          // A deeplink is made to be shared, so it carries the address and
          // nothing else — each recipient adds their own bearer.
          const params = new URLSearchParams({
            type: "streamable_http",
            url: remoteUrl(),
            id: SERVER_KEY,
            name: "ZeroMind",
            description:
              "Drive your browser-running Zero engine worlds via MCP.",
            timeout: "300",
          });
          const deeplink = `goose://extension?${params.toString()}`;
          return {
            label: "Generate `goose://extension` deeplink",
            status: "manual",
            note: `Share this URL for one-click install:\n  ${deeplink}\n(Recipients click it in their browser → Goose registers the extension. Each then adds their own \`Authorization: Bearer <install_secret>\` and \`X-ZM-Harness: goose\` headers, which the config.yaml edit above already did for you.)`,
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
    channel:
      "`AGENTS.md` (project root or `.junie/AGENTS.md`) + `.junie/mcp/mcp.json` (Junie's own MCP config, NOT the JetBrains IDE picker)",
    defaultScope: "project",
    scopes: ["project"],
    steps: [
      upsertBlockStep(
        "AGENTS.md",
        (ctx) => join(ctx.cwd, "AGENTS.md"),
        () => `## ZeroMind\n\n${MANUAL}`,
      ),
      editJsonMcpServerStep(
        "MCP server in .junie/mcp/mcp.json",
        (ctx) => join(ctx.cwd, ".junie/mcp/mcp.json"),
        () => literalServer("junie"),
        "mcpServers",
      ),
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
      editJsonMcpServerStep(
        "MCP server in ~/.config/amp/settings.json",
        () => expand("~/.config/amp/settings.json"),
        () => urlHeaders(literalServer("amp")),
        "amp.mcpServers",
      ),
      {
        label: "MCP server: Amp settings UI (VS Code extension)",
        run: () => ({
          label: "MCP server: Amp settings UI (VS Code extension)",
          status: "manual",
          note: `The step above writes the Amp CLI's settings file. Amp's VS Code extension keeps its own \`amp.mcpServers\` in VS Code settings — add it through Amp's MCP servers settings page:\n${manualEntry("amp")}`,
        }),
      },
    ],
  },

  hermes: {
    name: "Hermes Agent",
    channel:
      "`mcp_servers.zeromind` in `~/.hermes/config.yaml` (canonical, auto-discovers tools) + an optional Python plugin at `~/.hermes/plugins/zeromind/` that contributes skills, a `/zeromind` slash command, and a first-turn context hook.",
    defaultScope: "global",
    scopes: ["global"],
    steps: [
      {
        // Hermes' canonical channel for an external MCP server is the
        // mcp_servers.<name> block in ~/.hermes/config.yaml. Hermes reads
        // mcp_servers as a mapping keyed by server name (it iterates with
        // .items()), so write a dict entry — NOT a list item — or the CLI
        // crashes on startup. upsertYamlMapEntry also self-heals a config
        // that an earlier build corrupted into the list shape.
        label: "MCP server in ~/.hermes/config.yaml",
        run: async () => {
          const path = expand("~/.hermes/config.yaml");
          const s = literalServer("hermes");
          const status = await upsertYamlMapEntry(path, "mcp_servers", SERVER_KEY, {
            type: "streamable_http",
            url: s.url,
            headers: s.headers,
          });
          restrictToOwner(path);
          return {
            label: "MCP server in ~/.hermes/config.yaml",
            status,
            path,
            note: "Once the upstream catalog manifest is merged into nousresearch/hermes-agent, this will be installable via `hermes mcp install zeromind` instead.",
          };
        },
      },
      {
        // Optional Hermes plugin: skills + /zeromind slash command +
        // pre_llm_call context hook. Copies the bundle from
        // dist-publishing/hermes-plugin/zeromind into ~/.hermes/plugins/.
        label: "Plugin bundle: ~/.hermes/plugins/zeromind/",
        run: (ctx) => {
          const src = join(PKG_ROOT, "dist-publishing", "hermes-plugin", "zeromind");
          if (!existsSync(src)) {
            return {
              label: "Plugin bundle: ~/.hermes/plugins/zeromind/",
              status: "skipped",
              note: `Plugin bundle missing at ${src}.`,
            };
          }
          const dest = expand("~/.hermes/plugins/zeromind");
          const status = copyPluginBundle(src, dest, ctx.force);
          return {
            label: "Plugin bundle: ~/.hermes/plugins/zeromind/",
            status,
            path: dest,
            note:
              status === "exists"
                ? "Plugin already at this path — re-run with --force to refresh."
                : "Enable it: `hermes plugins enable zeromind` (Hermes plugins are opt-in by default).",
          };
        },
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
harness needs — the remote \`/mcp\` server into the harness's own config,
agent instructions into the harness's discovery path, plus any auxiliary
setup. This machine is linked first if it isn't already. Where the
harness has a CLI subcommand that can carry the server's headers
(\`codex mcp add --url\`, \`openclaw skills install\`) we shell out to it;
otherwise we edit the config file directly. Steps that require a harness
UI, or a harness whose MCP entry point is unconfirmed (openClaw, Aider),
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
  // Every entry the install writes carries this machine's install secret,
  // so the link comes first when there isn't one yet.
  if (!installSecret(loadCache())) {
    const { linkMachine } = await import("./cli-link.js");
    await linkMachine({
      out: (line) => process.stdout.write(line + "\n"),
      wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    });
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
