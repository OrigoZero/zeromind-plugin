# Harness-native publishing packages

Each subdirectory is a publish-ready package for a harness's native
registry / extension format. Submitting these turns the install path
from "`npx @origozero/zeromind install <harness>`" into the harness's
canonical one-click flow.

| Harness | Registry | Package | Submit |
|---|---|---|---|
| Cline | [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | [`cline-marketplace/zeromind.json`](./cline-marketplace/zeromind.json) | PR to `cline/mcp-marketplace` |
| openClaw | [ClawHub](https://github.com/openclaw/clawhub) | [`clawhub/zeromind/`](./clawhub/zeromind/) | `clawhub publish` from the package dir |
| Gemini CLI | [Gemini Extensions](https://github.com/google-gemini/gemini-cli/blob/main/docs/extension.md) | [`gemini-extension/zeromind/`](./gemini-extension/zeromind/) | Tag the repo + announce; users install via `gemini extensions install` |

Each subdirectory has a `README.md` with the exact submit / publish steps,
and the package layout follows that registry's schema.

These are NOT shipped to npm consumers — `dist-publishing/` is excluded
from the `files` list in `package.json`. They're maintainer artifacts kept
under version control so we can iterate on the manifests before
submitting.

## Until each registry listing is live

The `npx @origozero/zeromind install <harness>` CLI does the full native
install for every supported harness — see [`ide/<harness>/README.md`](../ide).
The registry listings are a UX upgrade (one-click install inside the
harness's UI), not a prerequisite.
