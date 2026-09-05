# ZeroMind for Zed

[Zed](https://zed.dev/) has a built-in Agent Panel that consumes both agent skills (`.claude/skills/<name>/SKILL.md` is auto-discovered) and a project `AGENTS.md`. MCP servers register as `context_servers`.

**Native channel:** agent skills + `AGENTS.md`.

## Install

Two pieces — the agent skill and the MCP server.

### 1. The agent skill

```
npx @origozero/zeromind install zed             # writes .claude/skills/zeromind/SKILL.md
npx @origozero/zeromind install zed --global    # writes ~/.claude/skills/zeromind/SKILL.md
```

Zed reads from the same `.claude/skills/` path Claude Code uses — if you already ran `zeromind install claude` you're done with this step.

### 2. MCP server

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "zeromind": {
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "zed"
      }
    }
  }
}
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Zed. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
