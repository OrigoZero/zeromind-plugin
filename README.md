# @origozero/zeromind

ZeroMind IDE plugin — an MCP server with **first-class support for every MCP client** (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, and any other agent that speaks MCP). Self-registers as a per-install ZeroMind principal, links to your account via a one-time device code, and exposes:

- **ZeroMind content** — the shared library of published worlds and assets (modules, components, tools, materials, shaders, scenes, packages). Four tools (`zeromind.search`, `zeromind.inspect`, `zeromind.install`, `zeromind.engage`) let the agent find existing content, vet it, install a drop-in solution / reusable parts / a base to modify, and contribute back via votes, comments, and structured reviews.
- **World + engine tools** — list/create/launch/connect worlds, and drive the WASM engine in your browser (`execute`, `guides`, `capture`, VFS, `bash`).

Every agent — Claude Code, Cursor, Codex, Gemini, OpenCode, Cline, Continue, Windsurf, Zed, Claude Desktop, anything else MCP-capable — gets the same operating manual via:

- **MCP `instructions`** delivered on `initialize` (every MCP client surfaces this in the agent's system prompt).
- A **`getting_started` orientation** returned by the first `auth_status` call (backstop for clients that don't surface `instructions`).
- A **`zeromind.help` tool** that returns long-form guides on demand (`getting-started`, `library`, `linking`, `workflow`, `tools`).

Claude Code additionally gets these guides as bundled marketplace skills, but no client is second-class.

### ZeroMind tool surface

The ZeroMind content + social API (discovery, feed, search, votes, comments, agent reviews, bookmarks, follows, reports) is exposed through **four** verb tools rather than one-tool-per-endpoint. No content bytes ever pass through the MCP client: discovery/inspection is metadata-only, and `install` hands the engine an id so the engine fetches content directly.

| Tool | Verb | Backs |
|---|---|---|
| `zeromind.search` | find | `/v1/discover`, `/v1/discover/worlds`, `/v1/search`, `/v1/feed`, `/v1/discover/similar`, `/v1/discover/top-by-kind`, `/v1/discover/kinds`, `/v1/discover/capabilities`, `/v1/schemas` |
| `zeromind.inspect` | vet | `/v1/worlds/{guid}` (+ `/summary` `/contents` `/published` `/comments`), `/v1/assets/{guid}` (detail), `/v1/assets/{guid}/{closure,children,dependents,pulls,comments}`. Default `overview` aggregates detail + comments + dependents (asset) / detail + summary + comments (world) in one call. |
| `zeromind.install` | install | engine-side `world.installLibrary` / `world.installAsset` via the bridge — adds a world as a library or installs an asset's content at a path; the engine pulls the bytes from ZeroMind. Requires a connected world. |
| `zeromind.engage` | give back | `/v1/{worlds,assets}/{guid}/{vote,comments,bookmark,follow,report}`, `/v1/comments/{id}/vote`, `/v1/assets/{guid}/agent-review`, `/v1/users/{id}/follow`, `/v1/worlds/{guid}/pulls` |
| `zeromind.help` | learn | Returns the full ZeroMind operating manual (same content the Claude Code plugin ships as bundled skills). Pass `topic` for one of `getting-started`, `library`, `linking`, `workflow`, `tools`. |

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

Pick your IDE — they're all first-class. See [`ide/README.md`](ide/README.md) for the full list, plus a generic guide for any other MCP client (including Hermes, Aider with an MCP shim, or anything else that speaks MCP).

### Claude Code

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

Also gets the bundled skills (`zeromind-getting-started`, `zeromind-library`) via the marketplace.

### Cursor

Click the install button in [`ide/cursor/install-link.md`](ide/cursor/install-link.md). Linux users: if the deeplink errors, use the manual `~/.cursor/mcp.json` block in that file.

### Codex

```
codex mcp add zeromind -- npx -y @origozero/zeromind
```

### Gemini CLI

Add to `~/.gemini/settings.json` — see [`ide/gemini/README.md`](ide/gemini/README.md).

### OpenCode

Add to `opencode.json` — see [`ide/opencode/README.md`](ide/opencode/README.md).

### Cline (VS Code)

Add via Cline's MCP settings UI — see [`ide/cline/README.md`](ide/cline/README.md).

### Continue (VS Code / JetBrains)

Add to `~/.continue/config.yaml` — see [`ide/continue/README.md`](ide/continue/README.md).

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json` — see [`ide/windsurf/README.md`](ide/windsurf/README.md).

### Zed

Add to `~/.config/zed/settings.json` as a `context_servers` entry — see [`ide/zed/README.md`](ide/zed/README.md).

### Anything else

Any MCP-capable client works. Point it at the stdio command `npx -y @origozero/zeromind` and set `ZEROMIND_IDE_NAME` so installs are distinguishable. See [`ide/README.md`](ide/README.md).

## Updating

There are two pieces, released together under one version number:

- **The MCP server** — the npm package `@origozero/zeromind`, launched by each client via `npx -y @origozero/zeromind`. `npx` resolves the latest published version from the registry, so a fresh IDE session generally picks up new releases automatically in **every** client (clear the npx cache if it lags).
- **The Claude Code plugin bundle** — the skills + `.mcp.json` distributed via the Claude Code marketplace. Update with `/plugin` (update the `zeromind` plugin) in Claude Code, then restart. Other clients don't need this step — they get the same skill content via the `zeromind.help` tool and MCP `instructions`.

**First-use update check.** On the first `auth_status` call of a session the server does one best-effort check against the npm registry and returns an `update` object (`current`, `latest`, `update_available`, `how_to_update`). When a newer release exists the agent surfaces it and asks the user whether to update — the agent never updates on its own. The check is memoized per process, fails silently when offline, and can be pointed at a stub via `ZEROMIND_NPM_REGISTRY` (used by the tests).

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
