# Hermes plugin

Optional Python plugin that contributes ZeroMind **skills + a slash command + a context-injection hook** on top of the MCP server. **The MCP server itself is registered separately via `mcp_servers.zeromind` in `~/.hermes/config.yaml`** — that's Hermes' canonical channel for an external MCP server (per [the docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)) and is what makes the tools (`auth_status`, `zeromind.search`, `world.connect`, `execute`, etc.) callable.

This plugin is the complement to that config entry.

## Layout

```
zeromind/
├── plugin.yaml       # Hermes manifest
├── __init__.py       # register(ctx) entrypoint
├── ORIENTATION.md    # condensed manual (injected via pre_llm_call on first turn)
└── skills/
    ├── zeromind-getting-started/SKILL.md
    └── zeromind-library/SKILL.md
```

## Install

### A. End-user (after the upstream catalog manifest is merged)

```
hermes mcp install zeromind
hermes plugins install OrigoZero/zeromind-plugin --enable    # for the skills + command + hook
```

### B. End-user, today

```
npx @origozero/zeromind install hermes
```

Writes the `mcp_servers.zeromind` entry into `~/.hermes/config.yaml` AND copies this whole plugin directory into `~/.hermes/plugins/zeromind/`. Then enable:

```
hermes plugins enable zeromind
```

(Hermes plugins are opt-in by default — discovery finds them but they don't load until added to `plugins.enabled`.)

## What this plugin contributes

| Surface | Description |
|---|---|
| `provides_skills` | `zeromind-getting-started`, `zeromind-library` — same skill content shipped to Claude Code / OpenCode / Zed / openClaw. |
| `provides_commands` | `/zeromind <topic>` — runs `ctx.dispatch_tool("zeromind.help", {topic})` against the MCP-discovered tool registry. |
| `pre_llm_call` hook | On the first turn of each session, injects the condensed orientation so the agent reaches for `zeromind.search` before defaulting to from-scratch coding. |

## Tools come from MCP, not this plugin

This plugin intentionally does **not** define `tools.py` / `schemas.py`. Wrapping the MCP server in a subprocess proxy or re-declaring its tools as native Hermes tools would duplicate Hermes' built-in MCP machinery (transport lifecycle, auto-discovery, per-tool filtering, OAuth, env-var substitution). The MCP config entry handles tool exposure; the plugin handles context + UX.

## Upstream catalog submission

The companion manifest at [`dist-publishing/hermes-catalog/manifest.yaml`](../hermes-catalog/manifest.yaml) is a PR-ready entry for `nousresearch/hermes-agent`'s `optional-mcps/zeromind/` directory. Once merged, `hermes mcp install zeromind` works without the user editing `~/.hermes/config.yaml` manually.
