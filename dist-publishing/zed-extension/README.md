# Zed extension

Native Zed extension that wires ZeroMind as a Zed `context_server`. No
language-server / WASM build needed — TOML-only extension per [Zed's
extension docs](https://zed.dev/docs/extensions/developing-extensions).

## Layout

- `extension.toml` — extension manifest with the `context_servers.zeromind` block.

## Install (end users)

Two paths, both native to Zed:

### A. Once published to the [Zed extension registry](https://zed.dev/extensions)

Open Zed → Command Palette → "zed: extensions" → search "ZeroMind" → Install.

### B. Local development install

Dev install the extension directly from this directory:

1. Command Palette → "zed: install dev extension".
2. Pick `dist-publishing/zed-extension/`.

The `npx @origozero/zeromind install zed` CLI in the main package copies
this directory into the user's Zed dev-extensions location.

## Submit to the registry

Per Zed's extension submission process:

1. Fork [`zed-industries/extensions`](https://github.com/zed-industries/extensions).
2. Add `zeromind` to `extensions.toml` with this directory as the source.
3. Open a PR.

## Upgrading

Bump `version` in `extension.toml` when the npm package version moves; the
registry pulls the latest tagged version.
