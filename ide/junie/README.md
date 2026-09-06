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

`zeromind install junie` writes `.junie/mcp/mcp.json`:

```json
{
  "mcpServers": {
    "zeromind": {
      "type": "http",
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "junie"
      }
    }
  }
}
```

The JetBrains IDE's own picker (Settings → Tools → AI Assistant → MCP Servers) takes the same URL and headers.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart the IDE. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
