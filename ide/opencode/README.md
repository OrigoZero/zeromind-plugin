# ZeroMind for OpenCode

[OpenCode](https://github.com/sst/opencode) is SST's open-source coding agent.

**Native channel:** skills (`.opencode/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, or `.agents/skills/<name>/SKILL.md` — OpenCode walks all three up to the git root; global counterparts under `~/.config/opencode/`, `~/.claude/`, `~/.agents/`). Plus `AGENTS.md`.

## Install

Two pieces — the agent skill and the MCP server.

### 1. The agent skill

```
npx @origozero/zeromind install opencode             # writes .opencode/skills/zeromind/SKILL.md
npx @origozero/zeromind install opencode --global    # writes ~/.config/opencode/skills/zeromind/SKILL.md
```

If you already ran `zeromind install claude`, OpenCode auto-discovers that same `.claude/skills/zeromind/SKILL.md` — no separate install needed.

### 2. MCP server

Add to `opencode.jsonc` in your project (or `~/.config/opencode/opencode.jsonc` globally):

```jsonc
{
  "mcp": {
    "zeromind": {
      "type": "local",
      "command": ["npx", "-y", "@origozero/zeromind"],
      "environment": { "ZEROMIND_IDE_NAME": "opencode" },
      "enabled": true
    }
  }
}
```

Restart OpenCode. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart OpenCode.
