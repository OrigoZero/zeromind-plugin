# Gemini CLI extension bundle

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports
[extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extension.md) — drop-in directories that bundle MCP servers + a context file (`GEMINI.md`) under a single name. This directory IS the extension.

## Layout

- `zeromind/gemini-extension.json` — extension manifest (declares the MCP server)
- `zeromind/GEMINI.md` — context file (the canonical operating manual)

## Install for end users

```
gemini extensions install https://github.com/OrigoZero/zeromind-plugin --path dist-publishing/gemini-extension/zeromind
```

…or for a published release tag:

```
gemini extensions install OrigoZero/zeromind-plugin@v0.5.0:dist-publishing/gemini-extension/zeromind
```

(The exact syntax depends on Gemini CLI's release — check the extension
docs.) Once installed, the MCP server is wired and `GEMINI.md` is loaded
automatically; no manual `~/.gemini/settings.json` edit.

## Updating

When `@origozero/zeromind` releases a new version:

1. Bump `version` in `zeromind/gemini-extension.json`.
2. Refresh `zeromind/GEMINI.md` from `templates/manual.md`.
3. Tag and push — users running `gemini extensions update zeromind` pick it up.

## Until the extension is published

The fallback path for Gemini CLI users is `npx @origozero/zeromind install
gemini`, which writes both `~/.gemini/settings.json` and `~/.gemini/GEMINI.md`
directly. See [`ide/gemini/README.md`](../../ide/gemini/README.md).
