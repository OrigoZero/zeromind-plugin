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

The public directory shared by ChatGPT and Codex takes submissions through OpenAI's portal ([Submit plugins](https://developers.openai.com/plugins/deploy/submission)). ZeroMind is not listed there, so it installs through a repo-scoped or personal marketplace. This repository is one: `codex plugin marketplace add OrigoZero/zeromind-plugin` reads `.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json` at its root.

## Publish (maintainer)

Codex marketplaces are git-tracked, so:

1. Bump `version` in `.codex-plugin/plugin.json`, here and at the repo root, when the npm package version moves. The root manifest is this one with `mcpServers` pointing at this directory's `.mcp.json`; `tests/directory-manifests.test.ts` fails if they differ anywhere else.
2. Refresh `skills/zeromind-getting-started/SKILL.md` and `skills/zeromind-library/SKILL.md` from the canonical sources (`skills/` at repo root).
3. Push to the main branch. Users running `/plugins` refresh of this marketplace pick up the new version.

## Updating

The `npx @origozero/zeromind install codex` CLI in the main package copies this whole `dist-publishing/codex-plugin/` directory into the user's local Codex personal marketplace path, falling back to direct `~/.codex/config.toml` + `~/.codex/AGENTS.md` edits if the marketplace path isn't where we expect.

## The install secret

A published bundle never holds a secret, so `.mcp.json` names `env_http_headers = { "Authorization" = "ZEROMIND_INSTALL_SECRET_BEARER" }` — Codex reads that header's whole value, `Bearer ins_sec_...`, from that variable. Run `npx @origozero/zeromind link` once, then either export it, or run `npx @origozero/zeromind install codex`, which writes `http_headers` with this machine's own `install_secret` into `~/.codex/config.toml` (mode 0600 off Windows) instead.
