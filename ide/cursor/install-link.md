# ZeroMind for Cursor

## One-click install

Click this link (Cursor must be installed):

[**Install ZeroMind in Cursor →**](cursor://anysphere.cursor-deeplink/mcp/install?name=zeromind&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvcmlnb3plcm8vemVyb21pbmQiXSwiZW52Ijp7IlpFUk9NSU5EX0lERV9OQU1FIjoiY3Vyc29yIn19)

## Manual install

Add to `~/.cursor/mcp.json`:

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

Restart Cursor. The first time you ask Cursor's agent to do something engine-related, it'll walk you through the one-time device-code link to your ZeroMind account.
