# @origozero/zeromind

ZeroMind IDE plugin — an MCP server that runs inside Claude Code, Cursor, and Codex. Self-registers as a per-install ZeroMind principal, links to your account via a one-time device code, and exposes ZeroMind world tools plus the Zero engine tool surface routed to the WASM engine in your browser.

## Status

Pre-release. Implementation in progress — see `docs/` for the design doc and implementation plan.

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
