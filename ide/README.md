# ZeroMind in any MCP client

ZeroMind ships as a plain stdio MCP server, so any MCP-capable agent or IDE can use it. Every client gets the same first-class agent onboarding (MCP `instructions` on `initialize`, a `getting_started` orientation on the first `auth_status` call, and the long-form `zeromind.help` tool on demand).

## Per-IDE install guides

- [Claude Code](./claude/README.md) — also gets bundled skills via the Claude Code plugin marketplace.
- [Cursor](./cursor/install-link.md)
- [Codex](./codex/README.md)
- [Gemini CLI](./gemini/README.md)
- [OpenCode](./opencode/README.md)
- [Cline](./cline/README.md) (VS Code)
- [Continue](./continue/README.md) (VS Code / JetBrains)
- [Windsurf](./windsurf/README.md)
- [Zed](./zed/README.md)

## Generic install

If your client isn't listed above, give it this stdio MCP server:

- **Command:** `npx`
- **Args:** `-y @origozero/zeromind`
- **Env:** `ZEROMIND_IDE_NAME=<your-client-name>` (free-form; helps ZeroMind tell installs apart in support cases)
- **Transport:** stdio

Equivalent JSON (the shape most clients accept):

```json
{
  "mcpServers": {
    "zeromind": {
      "command": "npx",
      "args": ["-y", "@origozero/zeromind"],
      "env": { "ZEROMIND_IDE_NAME": "your-client" }
    }
  }
}
```

That's all the plugin needs. Restart your client, then the first time you ask it to do anything engine-related ("list my worlds", "make me a new world", "add an inventory system") it will:

1. Call `auth_status` and read the returned `getting_started` orientation.
2. Walk you through the one-time device-code link to your ZeroMind account.
3. From there, drive ZeroMind discovery + the Zero engine in your browser the same way every other client does.

## What "first-class" means

The plugin used to treat Claude Code as primary (only Claude Code got the bundled skills that teach an agent what ZeroMind is and how to use it). That's fixed — the same operating manual is now delivered through MCP itself, so every client's agent gets it:

- **`instructions`** field on `initialize` — surfaced in the agent's system prompt by Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, and every other MCP-capable client.
- **`getting_started` block** on the first `auth_status` call — backstop for clients that don't surface `instructions`. The tool description already tells the agent to call `auth_status` first, so this lands at the start of every session.
- **`zeromind.help` tool** — on-demand long-form guides (`getting-started`, `library`, `linking`, `workflow`, `tools`). Same content the Claude Code plugin ships as bundled skills.

Claude Code additionally gets the content as native skill files via the Claude Code marketplace, but no client is second-class anymore.
