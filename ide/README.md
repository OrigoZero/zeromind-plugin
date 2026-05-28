# ZeroMind across agent harnesses

Each harness loads agent context through a different native channel. ZeroMind ships a **custom integration per harness**, plus a **generic MCP fallback** for anything not custom-crafted. There is no single "right" channel — `AGENTS.md`, `GEMINI.md`, skills, `.cursor/rules/*.mdc`, `.clinerules`, `CONVENTIONS.md`, `.goosehints` are all the harness deciding what shape it wants its context in.

## Custom-crafted integrations

| Harness | Native channel | One-shot install |
|---|---|---|
| [Claude Code](./claude/README.md) | skills (`.claude/skills/<name>/SKILL.md`) + plugin marketplace | `/plugin install zeromind` (or `npx @origozero/zeromind install claude`) |
| [Cursor](./cursor/install-link.md) | `.cursor/rules/<name>.mdc` (MDC frontmatter, agent-requested) | `npx @origozero/zeromind install cursor` |
| [Codex CLI](./codex/README.md) | `AGENTS.md` (project root or `~/.codex/AGENTS.md`) | `npx @origozero/zeromind install codex` |
| [Gemini CLI](./gemini/README.md) | `GEMINI.md` (project root or `~/.gemini/GEMINI.md`) | `npx @origozero/zeromind install gemini` |
| [OpenCode](./opencode/README.md) | skills (`.opencode/skills/<name>/SKILL.md`; also reads `.claude/skills/`, `AGENTS.md`) | `npx @origozero/zeromind install opencode` |
| [Cline](./cline/README.md) | `.clinerules/<name>.md` | `npx @origozero/zeromind install cline` |
| [Continue](./continue/README.md) | `.continue/rules/<name>.md` | `npx @origozero/zeromind install continue` |
| [Windsurf](./windsurf/README.md) | `AGENTS.md` (Cascade reads it dynamically) | `npx @origozero/zeromind install windsurf` |
| [Zed](./zed/README.md) | agent skills (`.claude/skills/<name>/SKILL.md`) + `AGENTS.md` | `npx @origozero/zeromind install zed` |
| [openClaw](./openclaw/README.md) | skills (`<workspace>/skills/<name>/SKILL.md`, AgentSkills-compatible) | `npx @origozero/zeromind install openclaw` |
| [JetBrains Junie](./junie/README.md) | `AGENTS.md` | `npx @origozero/zeromind install junie` |
| [Sourcegraph Amp](./amp/README.md) | `AGENT.md` (singular) | `npx @origozero/zeromind install amp` |
| [GitHub Copilot](./copilot/README.md) | `.github/copilot-instructions.md` | `npx @origozero/zeromind install copilot` |
| [Block Goose](./goose/README.md) | `~/.config/goose/.goosehints` | `npx @origozero/zeromind install goose` |
| [Aider](./aider/README.md) | `CONVENTIONS.md` (no MCP — instructions-only) | `npx @origozero/zeromind install aider` |

Every install command is idempotent — shared files (`AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.goosehints`, `copilot-instructions.md`) get a delimited `<!-- BEGIN ZEROMIND --> … <!-- END ZEROMIND -->` block; owned files (skills, rule files) get a plain write that skips unless `--force` is passed.

List supported harnesses at the CLI:

```
npx @origozero/zeromind install --list
```

## Generic MCP fallback

Anything not listed above falls back to the MCP protocol channel:

- **`instructions`** field on `initialize` — Claude Code injects it into the agent's system prompt; most other harnesses don't (or behavior is unconfirmed). Treat as belt-and-suspenders.
- **`zeromind.help` tool** — every MCP client can call this to fetch the full operating manual on demand (topics: `getting-started`, `library`, `linking`, `workflow`, `tools`).
- **`getting_started` block** on the first `auth_status` call — surfaces the condensed orientation through a tool result, which every client returns to the agent verbatim.

If your client speaks MCP, point it at:

- **Command:** `npx`
- **Args:** `-y @origozero/zeromind`
- **Env:** `ZEROMIND_IDE_NAME=<your-client>` (free-form; helps support cases)
- **Transport:** stdio

Equivalent JSON (the shape most clients accept):

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "your-client" }
    }
  }
}
```

If your client has a native context channel we haven't custom-crafted, open an issue at https://github.com/OrigoZero/zeromind-plugin/issues — adding another harness to the `zeromind install` CLI is a 20-line entry in `src/cli-install.ts`.

## Hermes

Nous Research's [Hermes Agent](https://github.com/nousresearch/hermes-agent) generates its own skills from experience rather than loading user-authored ones, so it stays on the generic MCP fallback for now. Hermes is itself an MCP client, so `zeromind.help` + `getting_started` will work; whether Hermes injects the MCP `instructions` field into its agent's prompt is unconfirmed.
