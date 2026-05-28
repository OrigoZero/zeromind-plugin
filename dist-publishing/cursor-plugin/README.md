# Cursor 3.0 plugin bundle

This directory IS the Cursor plugin. Drop it into `~/.cursor/plugins/local/zeromind/` and Cursor 3.0+ auto-discovers it.

## Layout

Per [Cursor plugin scaffold](https://github.com/cursor/plugins/blob/main/create-plugin/skills/create-plugin-scaffold/SKILL.md):

- `.cursor-plugin/plugin.json` — manifest
- `skills/zeromind-getting-started/SKILL.md`, `skills/zeromind-library/SKILL.md` — agent skills
- `rules/zeromind.mdc` — persistent agent rule (agent-requested via `description`)
- `mcp.json` — MCP server registration

## Install

### A. Marketplace (once published)

Install from [cursor.com/marketplace](https://cursor.com/marketplace) → search "ZeroMind" → one-click install.

### B. One-shot via the npm package

```
npx @origozero/zeromind install cursor
```

Copies this whole bundle into `~/.cursor/plugins/local/zeromind/`. Cursor picks it up at startup.

### C. Team marketplace

Team / Enterprise admins: Dashboard → Settings → Plugins → Import → paste this repo's URL.

## Submit to the public marketplace

PR to [`cursor/plugins`](https://github.com/cursor/plugins) — the official curated repo also serves as the marketplace catalog.

## Upgrading

Bump `version` in `.cursor-plugin/plugin.json` when the npm package version moves. Cursor refreshes plugins on startup; users running `npx @origozero/zeromind install cursor --force` get the latest bundle.
