# ZeroMind for Sourcegraph Amp

[Amp](https://ampcode.com/) is Sourcegraph's coding agent.

**Native channel:** `AGENT.md` (singular — distinct from the cross-tool `AGENTS.md`).

## Install

Two pieces — AGENT.md and the MCP server.

### 1. AGENT.md

```
npx @origozero/zeromind install amp   # appends a ZeroMind block to ./AGENT.md
```

Re-running is idempotent.

### 2. MCP server

Register through Amp's settings UI: add `npx -y @origozero/zeromind` with env `ZEROMIND_IDE_NAME=amp`.

Restart Amp. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart Amp.
