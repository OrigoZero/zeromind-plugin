# ZeroMind for GitHub Copilot

GitHub Copilot Chat (and VS Code's Copilot agent mode) reads per-repo instructions and now supports MCP servers.

**Native channel:** `.github/copilot-instructions.md`.

## Install

Two pieces — the per-repo instructions and the MCP server.

### 1. .github/copilot-instructions.md

```
npx @origozero/zeromind install copilot   # appends a ZeroMind block to .github/copilot-instructions.md
```

Re-running is idempotent — it replaces the existing ZeroMind block.

### 2. MCP server (VS Code Copilot agent mode)

In VS Code, open Settings → Features → Copilot → MCP servers and add:

```json
{
  "github.copilot.advanced": {
    "mcp": {
      "servers": {
        "zeromind": {
          "type": "http",
          "url": "https://origozero.ai/mcp",
          "headers": {
            "Authorization": "Bearer ins_sec_...",
            "X-ZM-Harness": "copilot"
          }
        }
      }
    }
  }
}
```

That is the path in VS Code's user `settings.json` — `github.copilot.advanced` is one literal key, with `mcp.servers` nested inside it. `zeromind install copilot` writes exactly this.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Reload VS Code. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

> Copilot Chat outside VS Code's agent mode does not call MCP tools. The instructions file still gives the agent context, but `zeromind.search` / `zeromind.install` won't be callable there.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
