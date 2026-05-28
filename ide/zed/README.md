# ZeroMind for Zed

[Zed](https://zed.dev/) has a built-in Agent Panel that consumes both agent skills (`.claude/skills/<name>/SKILL.md` is auto-discovered) and a project `AGENTS.md`. MCP servers register as `context_servers`.

**Native channel:** agent skills + `AGENTS.md`.

## Install

Two pieces — the agent skill and the MCP server.

### 1. The agent skill

```
npx @origozero/zeromind install zed             # writes .claude/skills/zeromind/SKILL.md
npx @origozero/zeromind install zed --global    # writes ~/.claude/skills/zeromind/SKILL.md
```

Zed reads from the same `.claude/skills/` path Claude Code uses — if you already ran `zeromind install claude` you're done with this step.

### 2. MCP server

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "zeromind": {
      "command": {
        "path": "npx",
        "args": ["-y", "@origozero/zeromind"],
        "env": { "ZEROMIND_IDE_NAME": "zed" }
      }
    }
  }
}
```

Restart Zed. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on Zed's PATH. Install from nodejs.org, restart Zed.
