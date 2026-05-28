# ZeroMind for Windsurf

[Windsurf](https://windsurf.com/) (Codeium's AI IDE) supports MCP servers via its Cascade agent.

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed.

## Install

Add ZeroMind to Windsurf's MCP config (`~/.codeium/windsurf/mcp_config.json`):

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

Restart Windsurf. The first engine-related prompt will trigger the one-time device-code link.

## What you get

Same first-class onboarding as every other MCP client — orientation via MCP `instructions`, `getting_started` block on the first `auth_status` call, and on-demand long-form guides via `zeromind.help`.

## Troubleshooting

**"status failed" after install** → Node.js isn't on PATH. Install from nodejs.org, restart Windsurf, retry.
