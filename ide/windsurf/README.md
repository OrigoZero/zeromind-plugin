# ZeroMind for Windsurf

[Windsurf](https://windsurf.com/) (Codeium's AI IDE) drives projects with the Cascade agent.

**Native channel:** `AGENTS.md` in the project root. Cascade reads it dynamically as it navigates. (The legacy `.windsurfrules` / `global_rules.md` still works.)

## Install

Two pieces — AGENTS.md and the MCP server.

### 1. AGENTS.md (instructions)

```
npx @origozero/zeromind install windsurf   # appends a ZeroMind block to ./AGENTS.md
```

Re-running is idempotent — it replaces the existing ZeroMind block. If you already wrote AGENTS.md for Codex or Junie, this is a no-op (one file, three harnesses).

### 2. MCP server

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "windsurf" }
    }
  }
}
```

Restart Windsurf. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart Windsurf.
