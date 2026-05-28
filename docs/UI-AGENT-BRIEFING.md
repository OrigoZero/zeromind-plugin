# Briefing: ZeroMind UI "bring your own agent" screen

For the agent that builds the ZeroMind UI's per-harness install screen — the one with the harness dropdown and a one-liner the user can copy.

## Source of truth

[`docs/install-matrix.json`](./install-matrix.json), validated by [`docs/install-matrix.schema.json`](./install-matrix.schema.json). Treat the JSON as the only place install commands are defined; never hardcode them in the UI. The JSON ships in the npm package (under `docs/`), so the UI can fetch it from a CDN (e.g. `unpkg.com/@origozero/zeromind/docs/install-matrix.json`) and pin a version, or read it from this repo at a tag.

## Screen layout

```
┌──────────────────────────────────────────────────────────┐
│  Install ZeroMind                                        │
│                                                          │
│  Which agent are you using?                              │
│  ┌────────────────────────────────────────────┐          │
│  │ ▼ Claude Code                              │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Prerequisites:                                          │
│    • Node.js 18+                                         │
│                                                          │
│  Run this in your project root:                          │
│  ┌────────────────────────────────────────────┐ [Copy]   │
│  │ npx @origozero/zeromind install claude     │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
│  Restart Claude Code. Or use the marketplace:            │
│  /plugin marketplace add OrigoZero/zeromind-plugin       │
│  then /plugin install zeromind.                          │
│                                                          │
│  › Other install paths                                   │
│  └─── Marketplace (preferred)                            │
│       /plugin marketplace add OrigoZero/zeromind-plugin  │
│       /plugin install zeromind                           │
│                                                          │
│  Tools available: ✓                                      │
│  Native channel: skills + plugin marketplace +           │
│                  ~/.claude/settings.json                 │
│  [Open per-harness docs →]                               │
└──────────────────────────────────────────────────────────┘
```

## Rendering rules

For each harness entry:

| Field | Where it goes | Notes |
|---|---|---|
| `display_name` | dropdown row label | Group rows by `category`. |
| `icon_hint` | dropdown row icon | Map to the right SVG client-side. |
| `prerequisites` | bullet list above the install block | Always show. |
| `primary_install.command` (or `.snippet`) | the big copy-able code block | This is the headline action. |
| `primary_install.post_install_note` | grey text under the block | |
| `alternatives` | disclosure (`› Other install paths`) | Collapsed by default. |
| `tools_available` + `tools_note` | small badge near the title | `✓ Tools available` (green) or `⚠ Instructions only` (yellow) with `tools_note` as a tooltip. |
| `native_channel` | grey footer line | Helps technical users understand what the install does under the hood. |
| `doc_url` | "Open per-harness docs" link | Always show. |

Categories for grouping (use these as dropdown section headers):

- `cli-agent` → "CLI agents" (Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider)
- `ide` → "IDEs" (Cursor, Windsurf, Zed)
- `ide-extension` → "IDE extensions" (Cline, Continue, Junie, Amp, GitHub Copilot)
- `personal-agent` → "Personal agents" (openClaw, Goose, Hermes)
- `generic` → "Other (any MCP client)" — single row at the bottom

Always render the `other` entry at the bottom under "Other" — it's the generic-MCP fallback for anyone whose harness isn't listed.

## `kind` switch for the install block

Render based on `primary_install.kind`:

- `shell` → render `command` in a `<pre>` block with a copy button. Mono font.
- `in-app-command` → render each line of `steps` as its own copyable line. Add a small "Run inside the agent" hint.
- `deeplink` → render `label` as an anchor with `href=url`. Add a small "Opens your client" hint.
- `marketplace` → same as deeplink visually; the link goes to the registry URL.
- `config-snippet` → render `snippet` in a `<pre>` block with a copy button + a label like "Paste this into your client's MCP config file."

## Defaults

- Default-selected harness: try to auto-detect from the user agent / referrer:
  - `Cursor/*` → `cursor`
  - `Code/*` (VS Code) → `cline` (best guess; user can switch to `continue` or `copilot`)
  - `Zed/*` → `zed`
  - No match → `claude`.
- Persist the user's last choice in localStorage.

## Updating the matrix

The matrix is regenerated whenever the npm package version moves. CI gate: `docs/install-matrix.json.version` must match `package.json.version`. The schema (`install-matrix.schema.json`) is stable across patch + minor bumps; major bumps need UI coordination.

## Why a JSON matrix and not a hardcoded React component

The harness list grows (new clients, new install paths). Keeping it in JSON shipped with the npm package means:

- One source of truth — the same matrix powers the UI, the per-harness READMEs (eventually generated from it), and any future install-helper widget.
- The UI can hot-swap to a new ZeroMind version without a UI redeploy by re-fetching the JSON from the CDN.
- A non-UI maintainer can add a new harness (or fix a typo in a one-liner) by editing one file.

The schema (`install-matrix.schema.json`) makes adding a new harness mechanical: the UI doesn't change.
