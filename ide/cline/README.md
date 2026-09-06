# ZeroMind for Cline

[Cline](https://github.com/cline/cline) is a VS Code / JetBrains autonomous coding agent (5M+ installs).

**Native channel:** `.clinerules` (single file or directory of markdown rules in the project).

## Install

Two pieces — the rules and the MCP server.

### 1. .clinerules

```
npx @origozero/zeromind install cline   # writes .clinerules/zeromind.md
```

### 2. MCP server

`zeromind install cline` writes VS Code's copy of `cline_mcp_settings.json` for you. On JetBrains, or a Code variant that keeps it elsewhere, open Cline's MCP settings (Command Palette → "Cline: MCP Servers" → "Configure MCP Servers") and add:

```json
{
  "mcpServers": {
    "zeromind": {
      "type": "streamableHttp",
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "cline"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Reload Cline. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
