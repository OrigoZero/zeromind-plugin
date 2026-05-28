# ZeroMind for Cline

[Cline](https://github.com/cline/cline) is a VS Code AI coding extension with MCP support.

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed.

## Install

In VS Code, open Cline's MCP settings (Command Palette → "Cline: MCP Servers" → "Configure MCP Servers") and add:

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

Save and reload Cline. The first engine-related prompt will trigger the one-time device-code link.

## What you get

Same first-class onboarding as every other client — MCP `instructions` orientation on `initialize`, `getting_started` block on the first `auth_status` call, and on-demand long-form guides via `zeromind.help`.

## Troubleshooting

**"status failed" after install** → Node.js isn't on VS Code's PATH. Install from nodejs.org, restart VS Code, retry.
