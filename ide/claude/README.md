# ZeroMind for Claude Code

**Native channel:** skills (`.claude/skills/<name>/SKILL.md`) + MCP server in Claude Code's settings + plugin marketplace.

## Install — pick one

### A. Marketplace (recommended)

Inside Claude Code:

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

Bundles the two ZeroMind skills + the MCP server. Survives upgrades through `/plugin` and Claude Code's normal plugin lifecycle.

### B. One-shot CLI (no marketplace)

From your project root:

```
npx @origozero/zeromind install claude
```

Does the same end-state as the marketplace install without going through `/plugin`:

- Drops `skills/zeromind-getting-started/SKILL.md` and `skills/zeromind-library/SKILL.md` into `.claude/skills/` (use `--global` for `~/.claude/skills/`).
- Adds the `mcpServers.zeromind` entry to `~/.claude/settings.json` (merging with whatever you already have), and this machine's install secret to the same file's `env`.

Claude Code expands `${VAR}` in an MCP entry's `url` and `headers`, so the entry names the variable rather than the secret:

```json
{
  "mcpServers": {
    "zeromind": {
      "type": "http",
      "url": "https://origozero.ai/mcp",
      "headers": {
        "Authorization": "Bearer ${ZEROMIND_INSTALL_SECRET}",
        "X-ZM-Harness": "claude-code"
      }
    }
  },
  "env": { "ZEROMIND_INSTALL_SECRET": "ins_sec_..." }
}
```

Restart Claude Code. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
