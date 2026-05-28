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
  "zeromind": {
    "command": "npx",
    "args": ["-y", "@origozero/zeromind"],
    "env": { "ZEROMIND_IDE_NAME": "copilot" }
  }
}
```

Reload VS Code. The first engine-related prompt in agent mode triggers the one-time device-code link.

> Copilot Chat outside VS Code's agent mode does not call MCP tools. The instructions file still gives the agent context, but `zeromind.search` / `zeromind.install` won't be callable there.

## Troubleshooting

**"status failed"** → Node.js isn't on VS Code's PATH. Install from nodejs.org, restart VS Code.
