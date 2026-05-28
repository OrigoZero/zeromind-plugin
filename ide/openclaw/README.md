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

Whether openClaw acts as an MCP client is unconfirmed — the skill IS the primary onboarding channel for this harness. If you do find an MCP entry point, register the server the same way as any stdio MCP host:

- Command: `npx`
- Args: `-y @origozero/zeromind`
- Env: `ZEROMIND_IDE_NAME=openclaw`

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart openClaw.
