# ZeroMind for Cursor

**Native channel:** project rules (`.cursor/rules/<name>.mdc`) + MCP server in `~/.cursor/mcp.json`.

## Install — pick one

### A. One-shot CLI

```
npx @origozero/zeromind install cursor
```

Does both pieces:

- Writes `.cursor/rules/zeromind.mdc` (MDC frontmatter, agent-requested via `description`).
- Adds the `mcpServers.zeromind` entry to `~/.cursor/mcp.json` (preserving your other MCP servers).

### B. Manual

MCP server — one-click:

[**Install ZeroMind MCP in Cursor →**](cursor://anysphere.cursor-deeplink/mcp/install?name=zeromind&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvcmlnb3plcm8vemVyb21pbmQiXSwiZW52Ijp7IlpFUk9NSU5EX0lERV9OQU1FIjoiY3Vyc29yIn19)

Or hand-edit `~/.cursor/mcp.json`:

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

Agent rule — drop the contents of [`templates/manual.md`](../../templates/manual.md) into `.cursor/rules/zeromind.mdc` with the MDC frontmatter (see [`src/cli-install.ts`](../../src/cli-install.ts) for the exact wrapper).

Restart Cursor. The first engine-related prompt triggers the one-time device-code link.
