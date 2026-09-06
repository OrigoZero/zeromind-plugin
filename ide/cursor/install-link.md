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

[**Install ZeroMind MCP in Cursor →**](cursor://anysphere.cursor-deeplink/mcp/install?name=zeromind&config=eyJ1cmwiOiJodHRwczovL29yaWdvemVyby5haS9tY3AiLCJoZWFkZXJzIjp7IkF1dGhvcml6YXRpb24iOiJCZWFyZXIgJHtlbnY6WkVST01JTkRfSU5TVEFMTF9TRUNSRVR9IiwiWC1aTS1IYXJuZXNzIjoiY3Vyc29yIn19)

The deeplink carries `${env:ZEROMIND_INSTALL_SECRET}` rather than a secret, so it is safe to share; export that variable, or hand-edit `~/.cursor/mcp.json` with the secret itself:

```json
{
  "mcpServers": {
    "zeromind": {
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "cursor"
      }
    }
  }
}
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Agent rule — drop the contents of [`templates/manual.md`](../../templates/manual.md) into `.cursor/rules/zeromind.mdc` with the MDC frontmatter (see [`src/cli-install.ts`](../../src/cli-install.ts) for the exact wrapper).

Restart Cursor. `npx -y @origozero/zeromind link` is what links this machine — once, before the entry above can authenticate.
