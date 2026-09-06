# Harness-native publishing packages

Each subdirectory is a publish-ready package for a harness's native
registry / extension format. Submitting these turns the install path
from "`npx @origozero/zeromind install <harness>`" into the harness's
canonical one-click flow.

| Harness | Registry | Package | Submit |
|---|---|---|---|
| Codex | [Codex Plugin Directory](https://developers.openai.com/codex/plugins) (curated by OpenAI; 3rd-party submissions "coming soon") | [`codex-plugin/`](./codex-plugin/) | Add this repo as a personal/repo marketplace via Codex `/plugins` UI; submit to OpenAI's curated directory once open |
| Cline | [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | [`cline-marketplace/zeromind.json`](./cline-marketplace/zeromind.json) | PR to `cline/mcp-marketplace` |
| openClaw | [ClawHub](https://github.com/openclaw/clawhub) | [`clawhub/zeromind/`](./clawhub/zeromind/) | `clawhub skill publish` from the package dir |
| Gemini CLI | [Gemini Extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extension.md) | [`gemini-extension/zeromind/`](./gemini-extension/zeromind/) | Tag the repo + announce; users install via `gemini extensions install` |
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

## Until each registry listing is live

The `npx @origozero/zeromind install <harness>` CLI does the full native
install for every supported harness — see [`ide/<harness>/README.md`](../ide).
The registry listings are a UX upgrade (one-click install inside the
harness's UI), not a prerequisite.
