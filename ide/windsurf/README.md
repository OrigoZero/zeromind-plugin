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
      "serverUrl": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "windsurf"
      }
    }
  }
}
```

Windsurf names a remote server's address `serverUrl`.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Windsurf. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
