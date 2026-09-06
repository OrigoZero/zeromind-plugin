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
      "httpUrl": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "gemini-cli"
      }
    }
  }
}
```

Gemini CLI names a streamable-HTTP server's address `httpUrl`. The shipped extension bundle carries `${ZEROMIND_INSTALL_SECRET}` in place of the secret, which Gemini CLI expands from your environment.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Gemini CLI. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
