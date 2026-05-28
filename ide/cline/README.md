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

Open Cline's MCP settings (Command Palette → "Cline: MCP Servers" → "Configure MCP Servers") and add:

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "cline" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Reload Cline. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on VS Code's PATH. Install from nodejs.org, restart VS Code.
