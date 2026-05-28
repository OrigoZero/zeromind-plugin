# ZeroMind for Cursor

**Native channel:** project rules (`.cursor/rules/<name>.mdc` with MDC frontmatter; agent-requested via the `description` field, not always-on).

## Install

Two pieces — Cursor's onboarding rule and the MCP server.

### 1. The agent rule

```
npx @origozero/zeromind install cursor   # writes .cursor/rules/zeromind.mdc
```

### 2. The MCP server

One-click (Cursor must be installed):

[**Install ZeroMind MCP in Cursor →**](cursor://anysphere.cursor-deeplink/mcp/install?name=zeromind&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvcmlnb3plcm8vemVyb21pbmQiXSwiZW52Ijp7IlpFUk9NSU5EX0lERV9OQU1FIjoiY3Vyc29yIn19)

Manual fallback — add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project):

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "cursor" }
    }
  }
}
```

Restart Cursor. The first engine-related prompt triggers the one-time device-code link.
