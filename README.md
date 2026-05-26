# @origozero/zeromind

ZeroMind IDE plugin — an MCP server that runs inside Claude Code, Cursor, and Codex. Self-registers as a per-install ZeroMind principal, links to your account via a one-time device code, and exposes ZeroMind world tools plus the Zero engine tool surface routed to the WASM engine in your browser.

## Status

v0.1.0 — feature-complete against the in-repo mock ZeroMind server. End-to-end (stdio MCP) tested. Production use against the live `origozero.ai` depends on:

- **L1 (ZeroMind backend)** — endpoints `/v1/installs/*`, `/v1/me/worlds`, `/v1/worlds`, `wss /v1/bridge`. Spec in [`docs/L1-BACKEND-BRIEFING.md`](docs/L1-BACKEND-BRIEFING.md).
- **L2 (engine bridge module)** — trusted Luau module that opens the WSS bridge on WASM boot. Tracked in `OrigoZero/zero`.

The plugin itself is shippable to npm today; it'll be functional end-to-end once L1 lands.

## Install (when released)

### Claude Code

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

### Cursor

Click the install button in `ide/cursor/install-link.md` (rendered on the README on GitHub).

### Codex

```
codex mcp add zeromind -- npx -y @origozero/zeromind
```

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
