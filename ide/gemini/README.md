# ZeroMind for Gemini CLI

**Native channel:** `GEMINI.md` — hierarchical lookup from the project root upward, plus global `~/.gemini/GEMINI.md`.

## Prerequisite

**Node.js 18+** on PATH. https://nodejs.org if needed; restart your terminal after install.

## Install

Two pieces — the GEMINI.md instructions and the MCP server.

### 1. GEMINI.md (instructions)

```
npx @origozero/zeromind install gemini             # writes ~/.gemini/GEMINI.md
npx @origozero/zeromind install gemini --project   # appends a ZeroMind block to ./GEMINI.md
```

Re-running the command is idempotent — it replaces the existing ZeroMind block instead of duplicating it.

### 2. MCP server

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "gemini-cli" }
    }
  }
}
```

Restart Gemini CLI. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart Gemini CLI.
