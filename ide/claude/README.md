# ZeroMind for Claude Code

## Prerequisite

**Node.js 18 or newer must be installed.** The plugin is a Node MCP server. Install from https://nodejs.org if needed, then restart Claude Code so it picks up the new PATH. Verify with `node --version`.

## Install

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

Restart Claude Code. The first time you ask Claude to do something engine-related ("list my worlds", "make me a new world"), it'll walk you through linking this Claude Code install to your ZeroMind account — a one-time device-code approval at https://origozero.ai/link.

## Troubleshooting

**"status failed" after install** → Node.js isn't installed or isn't on Claude Code's PATH. Install from nodejs.org, **restart Claude Code**, retry.
