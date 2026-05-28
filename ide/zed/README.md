# ZeroMind for Zed

[Zed](https://zed.dev/) supports MCP servers as "context servers" for its Agent panel.

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed.

## Install

Add ZeroMind to Zed's settings (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "zeromind": {
      "command": {
        "path": "npx",
        "args": ["-y", "@origozero/zeromind"],
        "env": { "ZEROMIND_IDE_NAME": "zed" }
      }
    }
  }
}
```

Restart Zed. The first engine-related prompt will trigger the one-time device-code link.

## What you get

Same first-class onboarding as every other MCP client — orientation via MCP `instructions`, `getting_started` block on the first `auth_status` call, and on-demand long-form guides via `zeromind.help`.

## Troubleshooting

**"status failed" after install** → Node.js isn't on Zed's PATH. Install from nodejs.org, restart Zed, retry.
