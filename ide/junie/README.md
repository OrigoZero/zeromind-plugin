# ZeroMind for JetBrains Junie

[Junie](https://www.jetbrains.com/junie/) is JetBrains' AI coding agent.

**Native channel:** `AGENTS.md` in the project root (the standard cross-tool convention).

## Install

Two pieces — AGENTS.md and the MCP server.

### 1. AGENTS.md

```
npx @origozero/zeromind install junie   # appends a ZeroMind block to ./AGENTS.md
```

Re-running is idempotent. If you already wrote AGENTS.md for Codex or Windsurf, this is a no-op (one file, three harnesses).

### 2. MCP server

Register through your JetBrains IDE: Settings → Tools → AI Assistant → MCP Servers. Add `npx -y @origozero/zeromind` with env `ZEROMIND_IDE_NAME=junie`.

Restart the IDE. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on the IDE's PATH. Install from nodejs.org, restart the IDE.
