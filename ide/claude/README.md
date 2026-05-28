# ZeroMind for Claude Code

**Native channel:** skills (`.claude/skills/<name>/SKILL.md`) + MCP server in Claude Code's settings + plugin marketplace.

## Install — pick one

### A. Marketplace (recommended)

Inside Claude Code:

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

Bundles the two ZeroMind skills + the MCP server. Survives upgrades through `/plugin` and Claude Code's normal plugin lifecycle.

### B. One-shot CLI (no marketplace)

From your project root:

```
npx @origozero/zeromind install claude
```

Does the same end-state as the marketplace install without going through `/plugin`:

- Drops `skills/zeromind-getting-started/SKILL.md` and `skills/zeromind-library/SKILL.md` into `.claude/skills/` (use `--global` for `~/.claude/skills/`).
- Adds the `mcpServers.zeromind` entry to `~/.claude/settings.json` (merging with whatever you already have).

Restart Claude Code. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from https://nodejs.org, restart Claude Code.
