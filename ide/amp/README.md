# ZeroMind for Sourcegraph Amp

[Amp](https://ampcode.com/) is Sourcegraph's coding agent.

**Native channel:** `AGENT.md` (singular — distinct from the cross-tool `AGENTS.md`).

## Install

Two pieces — AGENT.md and the MCP server.

### 1. AGENT.md

```
npx @origozero/zeromind install amp   # appends a ZeroMind block to ./AGENT.md
```

Re-running is idempotent.

### 2. MCP server

`zeromind install amp` writes the Amp CLI's `~/.config/amp/settings.json`:

```json
{
  "amp.mcpServers": {
    "zeromind": {
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "amp"
      }
    }
  }
}
```

Amp's VS Code extension keeps its own `amp.mcpServers` in VS Code settings — add the same URL and headers through Amp's MCP servers settings page.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Amp. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
