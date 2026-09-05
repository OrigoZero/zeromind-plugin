# ZeroMind for OpenCode

[OpenCode](https://github.com/sst/opencode) is SST's open-source coding agent.

**Native channel:** skills (`.opencode/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, or `.agents/skills/<name>/SKILL.md` — OpenCode walks all three up to the git root; global counterparts under `~/.config/opencode/`, `~/.claude/`, `~/.agents/`). Plus `AGENTS.md`.

## Install

Two pieces — the agent skill and the MCP server.

### 1. The agent skill

```
npx @origozero/zeromind install opencode             # writes .opencode/skills/zeromind/SKILL.md
npx @origozero/zeromind install opencode --global    # writes ~/.config/opencode/skills/zeromind/SKILL.md
```

If you already ran `zeromind install claude`, OpenCode auto-discovers that same `.claude/skills/zeromind/SKILL.md` — no separate install needed.

### 2. MCP server

Add to `opencode.jsonc` in your project (or `~/.config/opencode/opencode.jsonc` globally):

```jsonc
{
  "mcp": {
    "zeromind": {
      "type": "remote",
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "opencode"
      },
      "enabled": true
    }
  }
}
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart OpenCode. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
