# ZeroMind for openClaw

[openClaw](https://github.com/openclaw/openclaw) is a personal AI assistant ("the lobster way"). Its skill system is [AgentSkills-compatible](https://docs.openclaw.ai/tools/skills) — the same `SKILL.md` format Claude Code uses.

**Native channel:** skills (`<workspace>/skills/<name>/SKILL.md` or global `~/.openclaw/skills/<name>/SKILL.md`). Public registry: [ClawHub](https://github.com/openclaw/clawhub).

## Install

```
npx @origozero/zeromind install openclaw           # writes <project>/skills/zeromind/SKILL.md
npx @origozero/zeromind install openclaw --global  # writes ~/.openclaw/skills/zeromind/SKILL.md
```

You can also let openClaw fetch it itself:

```
openclaw skills install @origozero/zeromind
```

(Or publish a copy to ClawHub for one-command discovery via `clawhub`.)

## MCP support

Whether openClaw acts as an MCP client is unconfirmed — the skill IS the primary onboarding channel for this harness, and `zeromind install openclaw` prints the server as a manual step rather than writing a config path it cannot confirm. If you do find an MCP entry point, register it as a streamable-HTTP server:

- URL: `https://origozero.ai/mcp`
- Header `Authorization`: `Bearer ins_sec_...`
- Header `X-ZM-Harness`: `openclaw`

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

The ClawHub package in [`dist-publishing/clawhub/`](../../dist-publishing/clawhub/) carries the same entry with a `${ZEROMIND_INSTALL_SECRET}` expansion.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
