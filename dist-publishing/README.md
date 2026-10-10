# Harness-native publishing packages

Each subdirectory is a publish-ready package for a harness's native
registry / extension format. Submitting these turns the install path
from "`npx @origozero/zeromind install <harness>`" into the harness's
canonical one-click flow.

| Harness | Registry | Package | Submit |
|---|---|---|---|
| Codex | [Codex plugins](https://developers.openai.com/plugins/build/plugins) | [`codex-plugin/`](./codex-plugin/), mirrored by `.codex-plugin/plugin.json` at the repo root | `codex plugin marketplace add OrigoZero/zeromind-plugin`; the public directory takes submissions through OpenAI's portal |
| Cline | [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | [`cline-marketplace/zeromind.json`](./cline-marketplace/zeromind.json) | PR to `cline/mcp-marketplace` |
| openClaw | [ClawHub](https://github.com/openclaw/clawhub) | [`clawhub/zeromind/`](./clawhub/zeromind/) | `clawhub skill publish` from the package dir |
| Gemini CLI | [Gemini CLI extensions gallery](https://geminicli.com/docs/extensions/releasing/) | [`gemini-extension/zeromind/`](./gemini-extension/zeromind/), mirrored by `gemini-extension.json` at the repo root | The gallery crawls public repos with the `gemini-cli-extension` topic and a root manifest; users run `gemini extensions install https://github.com/OrigoZero/zeromind-plugin` |
| Cursor | [Cursor Marketplace](https://cursor.com/docs/reference/plugins) | [`cursor-plugin/`](./cursor-plugin/), listed by `.cursor-plugin/marketplace.json` at the repo root | Submit the repository link at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) |
| Zed | [Zed extensions](https://zed.dev/extensions) | [`zed-extension/`](./zed-extension/) | PR to `zed-industries/extensions` |
| Continue | [Continue Hub](https://hub.continue.dev/) | [`continue-hub/`](./continue-hub/) | Publish blocks via the Continue Hub web UI as `OrigoZero/zeromind-rule` + `OrigoZero/zeromind-mcp` |

Each subdirectory has a `README.md` with the exact submit / publish steps,
and the package layout follows that registry's schema.

`dist-publishing/` is in the `files` list in `package.json`, so these
packages ship with the npm package: `zeromind install cursor` and
`zeromind install codex` copy the bundle out of it, and the rest are
maintainer artifacts kept beside them under version control. A bundle
carrying skill or manual text is a byte-identical copy of `skills/` or
`templates/manual.md` — re-copy it whenever either changes.

The Gemini, Codex and Cursor directories read a manifest from the repo
root, not from here. Those root files point back into `skills/`,
`templates/` and these bundles, and `tests/directory-manifests.test.ts`
fails when a root manifest and its bundle disagree.

## Until each registry listing is live

The `npx @origozero/zeromind install <harness>` CLI does the full native
install for every supported harness — see [`ide/<harness>/README.md`](../ide).
The registry listings are a UX upgrade (one-click install inside the
harness's UI), not a prerequisite.
