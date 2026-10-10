# Gemini CLI extension bundle

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports
[extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extension.md) — drop-in directories that bundle MCP servers + a context file (`GEMINI.md`) under a single name. This directory IS the extension.

## Layout

- `zeromind/gemini-extension.json` — extension manifest (declares the MCP server)
- `zeromind/GEMINI.md` — context file (the canonical operating manual)

## Install for end users

```
gemini extensions install https://github.com/OrigoZero/zeromind-plugin
```

Gemini CLI installs a repository from its root, so that command reads the
`gemini-extension.json` at the root of this repo. It is this bundle's
manifest with one difference: its `contextFileName` is `templates/manual.md`,
the file `GEMINI.md` here is a copy of. Add `--ref <tag>` to pin a release.
Once installed, the MCP server is wired and the context file is loaded; no
manual `~/.gemini/settings.json` edit.

## Updating

When `@origozero/zeromind` releases a new version:

1. Bump `version` in `zeromind/gemini-extension.json` and in the root `gemini-extension.json`.
2. Refresh `zeromind/GEMINI.md` from `templates/manual.md`.
3. Tag and push. Users running `gemini extensions update zeromind` pick it up.

`tests/directory-manifests.test.ts` fails if the two manifests or the two context files differ.

## Until the extension is published

The fallback path for Gemini CLI users is `npx @origozero/zeromind install
gemini`, which writes both `~/.gemini/settings.json` and `~/.gemini/GEMINI.md`
directly. See [`ide/gemini/README.md`](../../ide/gemini/README.md).

## The install secret

A published bundle never holds a secret, so this one names `${ZEROMIND_INSTALL_SECRET}` and Gemini CLI expands it. Run `npx @origozero/zeromind link` once, then either export that variable, or run `npx @origozero/zeromind install gemini`, which writes the same entry with this machine's own `install_secret` in place of the expansion.
