# @origozero/zeromind

ZeroMind IDE plugin — an MCP server with **a custom-crafted native integration per agent harness**. Each supported harness (Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, openClaw, JetBrains Junie, Sourcegraph Amp, GitHub Copilot, Block Goose, Aider) gets its onboarding through that harness's own native channel — skills, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, `.clinerules`, `CONVENTIONS.md`, `.goosehints`, etc. Anything we haven't custom-crafted for falls back to a generic MCP integration that works on any MCP-capable client.

The plugin self-registers as a per-install ZeroMind principal, links to the user's account via a one-time device code, and exposes:

- **ZeroMind content** — the shared library of published worlds and assets (modules, components, tools, materials, shaders, scenes, packages). Four tools (`zeromind.search`, `zeromind.inspect`, `zeromind.install`, `zeromind.engage`) let the agent find existing content, vet it, install a drop-in solution / reusable parts / a base to modify, and contribute back via votes, comments, and structured reviews.
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
| `zeromind.help` | learn | Returns the full ZeroMind operating manual. Pass `topic` for one of `getting-started`, `library`, `linking`, `workflow`, `tools`. |

## Install

Each harness has its own one-shot command. See [`ide/README.md`](ide/README.md) for the full table.

```
# Pick your harness
npx @origozero/zeromind install claude       # .claude/skills/zeromind/SKILL.md
npx @origozero/zeromind install cursor       # .cursor/rules/zeromind.mdc
npx @origozero/zeromind install codex        # ~/.codex/AGENTS.md (or ./AGENTS.md)
npx @origozero/zeromind install gemini       # ~/.gemini/GEMINI.md (or ./GEMINI.md)
npx @origozero/zeromind install opencode     # .opencode/skills/zeromind/SKILL.md
npx @origozero/zeromind install cline        # .clinerules/zeromind.md
npx @origozero/zeromind install continue     # .continue/rules/zeromind.md
npx @origozero/zeromind install windsurf     # ./AGENTS.md
npx @origozero/zeromind install zed          # .claude/skills/zeromind/SKILL.md
npx @origozero/zeromind install openclaw     # skills/zeromind/SKILL.md
npx @origozero/zeromind install junie        # ./AGENTS.md
npx @origozero/zeromind install amp          # ./AGENT.md
npx @origozero/zeromind install copilot      # .github/copilot-instructions.md
npx @origozero/zeromind install goose        # ~/.config/goose/.goosehints
npx @origozero/zeromind install aider        # ./CONVENTIONS.md

npx @origozero/zeromind install --list       # enumerate
```

Each command is idempotent (shared files like `AGENTS.md` get a delimited `<!-- BEGIN ZEROMIND -->` block; re-running replaces the block in place).

You still wire the MCP server into your harness's MCP config — the per-harness READMEs under [`ide/`](ide/) give the exact JSON/TOML/YAML snippet each one wants.

### Claude Code (marketplace shortcut)

Claude Code users get the install bundled (server + skills) via the plugin marketplace:

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

### Anything else (generic MCP)

Any MCP-capable harness we haven't custom-crafted for can still use the plugin — see [`ide/README.md`](ide/README.md#generic-mcp-fallback) for the generic stdio MCP wiring. Hermes Agent currently falls here too (it generates its own skills rather than loading user-authored ones).

## Status

v0.1.0 — feature-complete against the in-repo mock ZeroMind server. End-to-end (stdio MCP) tested. Production use against the live `origozero.ai` depends on:

- **L1 (ZeroMind backend)** — endpoints `/v1/installs/*`, `/v1/me/worlds`, `/v1/worlds`, `wss /v1/bridge`. Spec in [`docs/L1-BACKEND-BRIEFING.md`](docs/L1-BACKEND-BRIEFING.md).
- **L2 (engine bridge module)** — trusted Luau module that opens the WSS bridge on WASM boot. Tracked in `OrigoZero/zero`.

The plugin itself is shippable to npm today; it'll be functional end-to-end once L1 lands.

## Prerequisites

**Node.js 18 or newer** must be installed and on your PATH. The plugin is a Node MCP server spawned by your harness via `npx`. If you don't have Node yet, install it:

- **macOS:** `brew install node` (or download from https://nodejs.org)
- **Linux:** your distro's package manager, or https://nodejs.org / [nvm](https://github.com/nvm-sh/nvm)
- **Windows:** https://nodejs.org (LTS installer) — restart your IDE after install so it picks up the new PATH

Verify with `node --version` (should print v18+ or higher). **If you see "status failed" after installing the plugin, Node is almost certainly the cause** — install it, restart your IDE, retry.

## Updating

There are two pieces, released together under one version number:

- **The MCP server** — the npm package `@origozero/zeromind`, launched by each harness via `npx -y @origozero/zeromind`. `npx` resolves the latest published version, so a fresh session generally picks up new releases automatically (clear the npx cache if it lags).
- **The native artifacts** written by `zeromind install <harness>` — re-run the install command after upgrading to refresh `AGENTS.md` blocks / skill content. Shared-file installs replace the existing ZeroMind block in place; owned-file installs need `--force` to overwrite.
- **The Claude Code plugin bundle** (skills + `.mcp.json`) is also distributed via the Claude Code marketplace and updated through `/plugin`.

**First-use update check.** On the first `auth_status` call of a session the server does one best-effort check against the npm registry and returns an `update` object (`current`, `latest`, `update_available`, `how_to_update`). When a newer release exists the agent surfaces it and asks the user whether to update — the agent never updates on its own. The check is memoized per process, fails silently when offline, and can be pointed at a stub via `ZEROMIND_NPM_REGISTRY` (used by the tests).

Maintainers: publishing is gated on a git tag (see Releasing) and `package.json` `version` is the source of truth — keep `VERSION` in `src/update.ts`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` in lockstep with it.

## Development

```bash
npm install
npm test          # run unit tests against the bundled mock ZeroMind server
npm run build     # compile TypeScript
npm run lint
```

The canonical agent operating manual lives in [`templates/manual.md`](templates/manual.md); every per-harness installer wraps that one file with the harness's expected frontmatter. Adding a new harness is a single entry in [`src/cli-install.ts`](src/cli-install.ts) plus a `ide/<harness>/README.md`.

## Releasing

Maintainer steps:

1. Bump version in `package.json`.
2. `git tag vX.Y.Z && git push --tags` — the publish workflow runs.

Requires `NPM_TOKEN` secret in repo settings, scoped to the `@origozero` npm org.

## License

MIT
