# ZeroMind for Goose

[Goose](https://block.github.io/goose/) is Block's open-source MCP-native agent.

**Native channel:** `~/.config/goose/.goosehints` (global instructions file).

## Install

Two pieces — the hints file and the MCP server.

### 1. .goosehints

```
npx @origozero/zeromind install goose   # appends a ZeroMind block to ~/.config/goose/.goosehints
```

Re-running is idempotent.

### 2. MCP server

```
goose mcp add zeromind -- npx -y @origozero/zeromind
```

Or register through the Goose desktop UI's MCP servers page.

Restart Goose. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart Goose.
