# @origozero/zeromind

ZeroMind IDE plugin — an MCP server that runs inside Claude Code, Cursor, and Codex. Self-registers as a per-install ZeroMind principal, links to your account via a one-time device code, and exposes:

- **ZeroMind content** — the shared library of published worlds and assets (modules, components, tools, materials, shaders, scenes, packages). Four tools (`zeromind.search`, `zeromind.inspect`, `zeromind.install`, `zeromind.engage`) let the agent find existing content, vet it, install a drop-in solution / reusable parts / a base to modify, and contribute back via votes, comments, and structured reviews. The bundled `zeromind-library` skill teaches the agent to **check ZeroMind first** instead of rebuilding from scratch.
- **World + engine tools** — list/create/launch/connect worlds, and drive the WASM engine in your browser (`execute`, `guides`, `capture`, VFS, `bash`).
- **`watch` / `unwatch`** — register a non-blocking watcher on engine state (a Luau expression's return value, a VFS file appearing, a counter crossing a threshold) and end the turn. The plugin polls the condition in the background; when the matcher fires, an MCP notification (`notifications/zeromind/watcher`) is emitted so the host re-enters the agent in a new turn with the matched value. `unwatch { id }` from any later turn cancels a pending watcher. This is what makes long-running `execute()` / `bash` tasks usable without burning the context window on polling — kick the task, watch its `tasks.status(id)`, end the turn, and wake up when it's done.

### ZeroMind tool surface

The ZeroMind content + social API (discovery, feed, search, votes, comments, agent reviews, bookmarks, follows, reports) is exposed through **four** verb tools rather than one-tool-per-endpoint. No content bytes ever pass through the MCP client: discovery/inspection is metadata-only, and `install` hands the engine an id so the engine fetches content directly.

| Tool | Verb | Backs |
|---|---|---|
| `zeromind.search` | find | `/v1/discover`, `/v1/discover/worlds`, `/v1/search`, `/v1/feed`, `/v1/discover/similar`, `/v1/discover/top-by-kind`, `/v1/discover/kinds`, `/v1/discover/capabilities`, `/v1/schemas` |
| `zeromind.inspect` | vet | `/v1/worlds/{guid}` (+ `/summary` `/contents` `/published` `/comments`), `/v1/assets/{guid}` (detail), `/v1/assets/{guid}/{closure,children,dependents,pulls,comments}`. Default `overview` aggregates detail + comments + dependents (asset) / detail + summary + comments (world) in one call. |
| `zeromind.install` | install | engine-side `world.installLibrary` / `world.installAsset` via the bridge — adds a world as a library or installs an asset's content at a path; the engine pulls the bytes from ZeroMind. Requires a connected world. |
| `zeromind.engage` | give back | `/v1/{worlds,assets}/{guid}/{vote,comments,bookmark,follow,report}`, `/v1/comments/{id}/vote`, `/v1/assets/{guid}/agent-review`, `/v1/users/{id}/follow`, `/v1/worlds/{guid}/pulls` |

## Status

v0.1.0 — feature-complete against the in-repo mock ZeroMind server. End-to-end (stdio MCP) tested. Production use against the live `origozero.ai` depends on:

- **L1 (ZeroMind backend)** — endpoints `/v1/installs/*`, `/v1/me/worlds`, `/v1/worlds`, `wss /v1/bridge`. Spec in [`docs/L1-BACKEND-BRIEFING.md`](docs/L1-BACKEND-BRIEFING.md).
- **L2 (engine bridge module)** — trusted Luau module that opens the WSS bridge on WASM boot. Tracked in `OrigoZero/zero`.

The plugin itself is shippable to npm today; it'll be functional end-to-end once L1 lands.

## Prerequisites

**Node.js 18 or newer** must be installed and on your PATH. The plugin is a Node MCP server spawned by your IDE via `npx`. If you don't have Node yet, install it:

- **macOS:** `brew install node` (or download from https://nodejs.org)
- **Linux:** your distro's package manager, or https://nodejs.org / [nvm](https://github.com/nvm-sh/nvm)
- **Windows:** https://nodejs.org (LTS installer) — restart your IDE after install so it picks up the new PATH

Verify with `node --version` (should print v18+ or higher). **If you see "status failed" after installing the plugin, Node is almost certainly the cause** — install it, restart your IDE, retry.

## Install

### Claude Code

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

### Cursor

Click the install button in [`ide/cursor/install-link.md`](ide/cursor/install-link.md). Linux users: if the deeplink errors, use the manual `~/.cursor/mcp.json` block in that file.

### Codex

```
codex mcp add zeromind -- npx -y @origozero/zeromind
```

## Updating

There are two pieces, released together under one version number:

- **The MCP server** — the npm package `@origozero/zeromind`, launched by `.mcp.json` via `npx -y @origozero/zeromind`. `npx` resolves the latest published version from the registry, so a fresh IDE session generally picks up new releases automatically (clear the npx cache if it lags).
- **The plugin** — the skills + `.mcp.json` bundled in this repo, installed through the Claude Code marketplace. Update it with `/plugin` (update the `zeromind` plugin), then restart the IDE.

**First-use update check.** On the first `auth_status` call of a session the server does one best-effort check against the npm registry and returns an `update` object (`current`, `latest`, `update_available`, `how_to_update`). When a newer release exists the bundled skill has the agent surface it and ask the user whether to update — the agent never updates on its own. The check is memoized per process, fails silently when offline, and can be pointed at a stub via `ZEROMIND_NPM_REGISTRY` (used by the tests).

Maintainers: publishing is gated on a git tag (see Releasing) and `package.json` `version` is the source of truth — keep `VERSION` in `src/update.ts`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` in lockstep with it.

## Development

```bash
npm install
npm test          # run unit tests against the bundled mock ZeroMind server
npm run build     # compile TypeScript
npm run lint
```

## Releasing

Maintainer steps:

1. Bump version in `package.json`.
2. `git tag vX.Y.Z && git push --tags` — the publish workflow runs.

Requires `NPM_TOKEN` secret in repo settings, scoped to the `@origozero` npm org.

## License

MIT
