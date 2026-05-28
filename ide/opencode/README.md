# ZeroMind for OpenCode

[OpenCode](https://github.com/sst/opencode) is an open-source AI coding agent that speaks MCP. ZeroMind is a first-class citizen there.

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed.

## Install

Add ZeroMind to OpenCode's MCP config (`opencode.json` in your project, or `~/.config/opencode/opencode.json` globally):

```json
{
  "mcp": {
    "zeromind": {
      "type": "local",
      "command": ["npx", "-y", "@origozero/zeromind"],
      "environment": { "ZEROMIND_IDE_NAME": "opencode" },
      "enabled": true
    }
  }
}
```

Restart OpenCode. The first engine-related prompt will trigger the one-time device-code link to your ZeroMind account.

## What you get

OpenCode sees the same ZeroMind surface as Claude Code, Cursor, Codex, and Gemini CLI:

- MCP `instructions` orientation delivered at `initialize`.
- A `getting_started` block on the first `auth_status` call.
- Long-form guides on demand via `zeromind.help { topic: "library" | "getting-started" | "linking" | "workflow" | "tools" }`.

## Troubleshooting

**"status failed" after install** → Node.js isn't on PATH. Install from nodejs.org, restart OpenCode, retry.
