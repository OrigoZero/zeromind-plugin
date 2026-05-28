# Codex plugin bundle

This directory IS the Codex plugin — drop it into a Codex marketplace
(repo-scoped or personal) and Codex picks it up.

## Layout

Per the [Codex plugin spec](https://developers.openai.com/codex/plugins/build):

- `.codex-plugin/plugin.json` — manifest. Component pointers must be relative paths starting with `./`.
- `skills/zeromind-getting-started/SKILL.md`, `skills/zeromind-library/SKILL.md` — the two ZeroMind skills (sourced from `skills/` at the repo root).
- `.mcp.json` — MCP server registration (component path referenced from the manifest).

## Install (end users)

In Codex:

1. Open `/plugins`.
2. Add this repo as a marketplace source (GitHub shorthand, Git URL, SSH URL, or local directory).
3. Install the `zeromind` plugin from the resulting list.

Codex copies the plugin into its local marketplace cache and wires both the skills and the MCP server.

Per OpenAI's launch announcement, the OpenAI-curated Plugin Directory is **not yet open** for third-party submissions ("coming soon"). Until it is, ZeroMind is installable through repo-scoped or personal marketplaces.

## Publish (maintainer)

Codex marketplaces are git-tracked, so:

1. Bump `version` in `.codex-plugin/plugin.json` when the npm package version moves.
2. Refresh `skills/zeromind-getting-started/SKILL.md` and `skills/zeromind-library/SKILL.md` from the canonical sources (`skills/` at repo root).
3. Push to the main branch. Users running `/plugins` refresh of this marketplace pick up the new version.

## Updating

The `npx @origozero/zeromind install codex` CLI in the main package copies this whole `dist-publishing/codex-plugin/` directory into the user's local Codex personal marketplace path, falling back to direct `~/.codex/config.toml` + `~/.codex/AGENTS.md` edits if the marketplace path isn't where we expect.
