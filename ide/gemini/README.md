# ZeroMind for Gemini CLI

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed and restart your terminal. Verify with `node --version`.

## Install

Add ZeroMind to Gemini CLI's MCP settings (`~/.gemini/settings.json`):

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "gemini-cli" }
    }
  }
}
```

Restart Gemini CLI. The first engine-related prompt will trigger the one-time device-code link to your ZeroMind account.

## What you get

Gemini CLI sees the same first-class ZeroMind surface as every other IDE:

- The condensed orientation is delivered via the MCP `instructions` field (Gemini CLI includes it in the agent's system prompt on `initialize`).
- The first `auth_status` call returns the same orientation as a `getting_started` field, so the agent gets oriented even if `instructions` isn't surfaced.
- Long-form guides (`getting-started`, `library`, `linking`, `workflow`, `tools`) are available any time via the `zeromind.help` tool.

## Troubleshooting

**"status failed" after install** → Node.js isn't on PATH. Install from nodejs.org, restart Gemini CLI, retry.
