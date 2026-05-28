# Prompt: build the ZeroMind "Bring Your Own Agent" install screen

Hand this whole document to the UI agent / IC building the screen. Self-contained — they don't need to read the rest of the repo.

---

## 1. What you're building

A screen on the ZeroMind dashboard at `https://origozero.ai/install` (or wherever your routing puts it) that lets a logged-in user install the ZeroMind plugin into whichever **AI coding agent harness** they use. The plugin gives their agent the ability to:

- Search and install published worlds + assets (the ZeroMind content library — voted, reviewed, ranked).
- Drive the Zero engine that's running in the user's browser tab (`execute`, `capture`, VFS, `bash`).
- Contribute back (votes, comments, agent reviews).

There are **17 harness options** the user might pick — from Claude Code to Hermes Agent to "any other MCP client" — each with its own native install path. The screen's job is to abstract that complexity into one focused choice and one copy-able command.

This is the agent-install equivalent of a "Connect your tool" screen on a SaaS dashboard.

## 2. Audience

A ZeroMind user who's just signed up, or an existing user adding a new agent. They are technical (they use AI coding agents) but they should not need to read docs to install — one harness pick + one copy-paste should be all it takes for ~90% of them.

## 3. Goals + non-goals

**Goals:**
- Get the user from "I picked Claude Code" → "ZeroMind is wired up in my agent" in under 60 seconds.
- Make it obvious which harnesses ZeroMind supports (so adoption-curious users don't bounce).
- Never lie about capability — flag harnesses where tools won't work (Aider) or are limited (Copilot Chat without agent mode).
- Be future-proof: adding a new harness ships from `install-matrix.json` alone, no UI redeploy required.

**Non-goals:**
- Auto-detecting the user's installed agents (we can't, and guessing wrong is worse than asking).
- Embedding a one-click install button per harness (each harness ships its own; we link out where applicable).
- Validating that the install worked (the agent itself reports back on first ZeroMind tool call — that's a separate "verification" loop).

## 4. Source of truth — **never hardcode**

[`docs/install-matrix.json`](./install-matrix.json), validated by [`docs/install-matrix.schema.json`](./install-matrix.schema.json). Fetch one of:

- **CDN (recommended):** `https://unpkg.com/@origozero/zeromind/docs/install-matrix.json` — version-pinnable via `@^0.5`.
- **GitHub raw at a tag:** `https://raw.githubusercontent.com/OrigoZero/zeromind-plugin/v0.5.0/docs/install-matrix.json`.
- **Bundled with the dashboard:** copy at build time; refresh weekly.

The matrix has 17 entries (16 harnesses + a generic `other`). Each entry drives one row in the harness dropdown. Treat the JSON as immutable — render from it, don't transform it. The schema is stable across patch + minor bumps.

## 5. The user journey

```
┌─ Land on screen ──────────────────────────────────────┐
│  Default harness: Claude Code (or user's last pick,   │
│  or best-guess from `User-Agent` / `Referer`).        │
└──────────────────────────────────────────────────────┘
           │
           ▼
┌─ Pick harness from dropdown ──────────────────────────┐
│  17 options grouped by category. The dropdown shows   │
│  display_name + a small badge for tools_available     │
│  state (green ✓ tools, yellow ⚠ instructions-only).   │
│  Each option has an icon driven by icon_hint.         │
└──────────────────────────────────────────────────────┘
           │
           ▼
┌─ See the install card ─────────────────────────────────┐
│  Prerequisites checklist                               │
│  Primary install (big copy-able block)                 │
│  Post-install note                                     │
│  [optional] Alternatives accordion                     │
│  Native channel footer + per-harness docs link         │
└──────────────────────────────────────────────────────┘
           │
           ▼
┌─ User runs the command in their terminal ─────────────┐
│  No UI feedback expected at this point — the user is  │
│  off-platform.                                         │
└──────────────────────────────────────────────────────┘
           │
           ▼
┌─ First ZeroMind tool call from the agent ─────────────┐
│  When their agent runs `auth_status` for the first    │
│  time, ZeroMind's backend gets a new install_id +     │
│  link-pending state. The dashboard already has a      │
│  separate "linked installs" page — direct the user    │
│  there in the post-install note. Out of scope here.   │
└──────────────────────────────────────────────────────┘
```

## 6. Layout + states

### Default (a harness is selected)

```
┌──────────────────────────────────────────────────────────────┐
│  Install ZeroMind in your agent                              │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  Which agent are you using?                                  │
│  ┌──────────────────────────────────────────────────┐        │
│  │  [icon]  Claude Code                       ▼     │        │
│  └──────────────────────────────────────────────────┘        │
│                                                              │
│  ✓ Tools available                                           │
│  Native channel: skills + plugin marketplace + ~/.claude/    │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│                                                              │
│  Before you run this:                                        │
│    • Node.js 18+                                             │
│                                                              │
│  Run this in your project root:                              │
│  ┌─────────────────────────────────────────────┐ [📋 Copy]  │
│  │  npx @origozero/zeromind install claude     │             │
│  └─────────────────────────────────────────────┘             │
│  Restart Claude Code. Or use the marketplace:                │
│  /plugin marketplace add OrigoZero/zeromind-plugin           │
│  /plugin install zeromind.                                   │
│                                                              │
│  › Other install paths                                       │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│  [Open per-harness docs ↗]                                   │
└──────────────────────────────────────────────────────────────┘
```

### Aider variant (instructions-only)

```
  ⚠ Instructions only          ← yellow badge
  Aider does not support MCP. The agent gets ZeroMind's
  operating manual in CONVENTIONS.md, but cannot call
  zeromind.search / world.connect / etc.
```

Show `tools_note` as an inline explainer right under the badge.

### "Other" variant (config snippet)

```
  ✓ Works on any MCP client
  ┌────────────────────────────────────────────┐ [📋 Copy]
  │  {                                          │
  │    "mcpServers": {                          │
  │      "zeromind": {                          │
  │        "command": "npx",                    │
  │        "args": ["-y", "@origozero/zeromind"]│
  │      }                                      │
  │    }                                        │
  │  }                                          │
  └────────────────────────────────────────────┘
  Paste this into your client's MCP-server config file.
```

### "Copied" feedback

When the user clicks Copy on the primary command, swap the icon + label for ~1.5s:

```
[✓ Copied]
```

### Empty / loading

While the matrix is fetching:

```
  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  ← skeleton, two-line shimmer
  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
```

Hide the dropdown until the matrix is loaded; show a "Loading agents…" placeholder.

### Matrix-fetch failure

If the CDN call errors and there's no bundled fallback:

```
  Couldn't load the install matrix.
  Reload the page, or follow the docs:
  [github.com/OrigoZero/zeromind-plugin/blob/main/ide/README.md ↗]
```

## 7. Production copy

Use these strings verbatim. They're tuned for the audience and tested for length.

| Slot | Copy |
|---|---|
| Screen title | `Install ZeroMind in your agent` |
| Subtitle | `Pick your AI coding agent. One command, you're done.` |
| Dropdown label | `Which agent are you using?` |
| Tools-available badge | `✓ Tools available` (green) |
| Instructions-only badge | `⚠ Instructions only` (yellow) |
| Native channel label | `Native channel:` (grey, monospace value) |
| Prerequisites label | `Before you run this:` |
| Shell install label | `Run this in your project root:` |
| Global-install variant | `Run this anywhere:` (for harnesses where `primary_install.label` says so) |
| Config-snippet label | `Paste this into your client's MCP-server config file.` |
| In-app-command label | `Run inside the agent:` |
| Deeplink label | `Open in your client:` (button text from `label`) |
| Marketplace label | `Install from the marketplace:` (button text from `label`) |
| Copy button (idle) | `📋 Copy` |
| Copy button (clicked) | `✓ Copied` |
| Alternatives accordion | `› Other install paths` (collapsed) / `▼ Other install paths` (open) |
| Docs link | `Open per-harness docs ↗` |
| Footer (last updated) | `Install instructions for ZeroMind v{matrix.version}` |

For the post-install note: render `primary_install.post_install_note` verbatim, but render Markdown-style backticks as `<code>` inline.

## 8. Per-harness considerations (read this before you build)

These are real edge cases worth getting right; they're encoded in the matrix but worth highlighting:

| Harness | Watch out for |
|---|---|
| **Claude Code** | The marketplace alternative is preferred — show it as the highlighted alternative, not just buried in "Other install paths." |
| **Codex CLI** | The post-install note tells the user to open `/plugins` in Codex — make that visually distinct (different background colour) since it's a step inside their agent, not a shell command. |
| **Cursor** | Has both a one-click MCP deeplink AND the npx install. The deeplink only wires the MCP server, not the rule — say that. |
| **Aider** | `tools_available: false`. The badge + `tools_note` MUST appear, prominently. Don't bury it. |
| **GitHub Copilot** | `tools_available: true` but `tools_note` explains it only works in VS Code's agent mode, not Copilot Chat. Show the note. |
| **Hermes Agent** | Two steps post-install: the user runs the npx command AND has to run `hermes plugins enable zeromind` (Hermes plugins are opt-in). The post-install note covers this — render it carefully. |
| **openClaw** | `tools_available: false`. ZeroMind is shipped as a skill; the MCP layer is unconfirmed. Treat as instructions-only for now. |
| **Goose** | The alternatives include a `goose://` deeplink — render it as a real anchor (`<a href="goose://...">`). Some browsers block these without user interaction, so render it as a button labelled "Open in Goose" rather than a raw URL. |
| **Continue** | The alternative is a config snippet for Continue Hub (which doesn't exist yet — once published this becomes the primary). Surface it as "available soon" copy. |
| **Cline** | Similar — MCP Marketplace listing is pending. Frame the marketplace alternative as "Coming soon." |
| **Other** | This row's `primary_install.kind` is `config-snippet`, not `shell`. Make sure your renderer handles both correctly. |

## 9. Rendering each `kind`

| `kind` | Render |
|---|---|
| `shell` | `<pre><code>` block + Copy button. `command` is what's copied. |
| `in-app-command` | Each item in `steps[]` on its own line with its own Copy button. Add an inline `Run inside the agent` hint above. |
| `deeplink` | Anchor styled as a button. `href=url`, label from `label`. Add a small "Opens your client" tooltip. |
| `marketplace` | Same visual as `deeplink` but icon is a shopping/bag glyph instead of a play glyph. `href=url`. |
| `config-snippet` | `<pre><code>` block + Copy button. `snippet` is what's copied. Render the `label` above the block. |

For all kinds, render `post_install_note` (and `note` on alternatives) below the action.

## 10. Grouping the dropdown

Group rows by `category`:

- **CLI agents** — Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider
- **IDEs** — Cursor, Windsurf, Zed
- **IDE extensions** — Cline, Continue, JetBrains Junie, Sourcegraph Amp, GitHub Copilot
- **Personal agents** — openClaw, Block Goose, Hermes Agent
- **Other** — the generic MCP-client fallback (always last, in its own bottom-pinned group)

The category label is shown once as a group header in the dropdown. Categories aren't a hierarchy — they're just a visual grouping.

## 11. Default harness

In priority order:

1. `localStorage.getItem("zm.lastHarness")` if it's a valid id from the matrix.
2. User-Agent / Referrer sniff:
   - `Cursor/*` → `cursor`
   - `Code/*` (VS Code) → `cline` (best guess; let the user override)
   - `Zed/*` → `zed`
   - Anything else → `claude`.
3. If matrix fetch failed: don't render the dropdown; render the failure state.

Persist any user selection to `localStorage` immediately on change.

## 12. URL deep-linking

Support `?harness=<id>` for direct linking. e.g. `https://origozero.ai/install?harness=codex` selects Codex. Useful for support docs, blog posts, etc. If `harness` query param doesn't match a known id, fall back to the default-detection above and silently drop the param.

## 13. Analytics

Fire one event per:

- `install_screen_viewed` `{ default_harness }`
- `install_harness_changed` `{ from, to }`
- `install_command_copied` `{ harness, kind }` — the main success metric
- `install_alternative_opened` `{ harness, alternative_kind }`
- `install_docs_opened` `{ harness }`

No PII. `harness` is the matrix `id`, not the display name.

## 14. Accessibility

- Dropdown must be keyboard navigable (`Tab` to focus, `↓` to open, `↑/↓` to walk, `Enter` to select).
- The Copy button must be focusable and have an `aria-label` like `Copy install command for Claude Code`. After click, swap to `Command copied to clipboard` for screen readers.
- The tools-available badge needs an `aria-label` like `ZeroMind tools are available in this agent` (or the inverse for instructions-only).
- The deeplink/marketplace alternatives use `<a>` tags, not buttons-as-anchors.

## 15. Mobile

The screen is unlikely to be primarily used on mobile (the user needs a terminal to actually run the install), but for casual browsing:

- Single column.
- Copy button stays visible — don't hide it behind a hover state.
- Pre/code blocks scroll horizontally rather than wrapping.

## 16. Implementation notes

- Render from the matrix on the client. SSR is fine but doesn't help much — the matrix is small (~6KB).
- Schema-validate the matrix at build time if you're bundling it. At runtime, treat schema violations as a soft warning (log + fall back to a stale cached version).
- Don't fall back to hardcoded strings for individual harnesses. Either the matrix renders, or the matrix-fetch-failure state renders. Never mix.

## 17. Out of scope (don't build, don't worry about)

- Confirming the install actually worked. The agent reports `linked: false → true` on its own — surface that on a separate "Connected installs" page.
- Per-harness onboarding videos or screencasts. Link out to the docs instead.
- "Try ZeroMind without installing" — there's no such mode; the agent has to be MCP-connected.
- Automatic harness detection on the server side. The client-side User-Agent sniff is good enough.

---

## Appendix: minimal example data

For the implementor: here's the shape of a single harness entry from the matrix. Source-of-truth lives in [`install-matrix.json`](./install-matrix.json); don't paste this into your bundle.

```json
{
  "id": "codex",
  "display_name": "Codex CLI",
  "category": "cli-agent",
  "icon_hint": "openai",
  "tools_available": true,
  "prerequisites": ["Node.js 18+"],
  "primary_install": {
    "kind": "shell",
    "command": "npx @origozero/zeromind install codex",
    "label": "Run anywhere (writes to ~/.codex/)",
    "post_install_note": "Open Codex's `/plugins` UI to enable the zeromind plugin from your personal marketplace."
  },
  "alternatives": [
    {
      "kind": "shell",
      "label": "MCP server only",
      "command": "codex mcp add zeromind -- npx -y @origozero/zeromind"
    }
  ],
  "native_channel": "Codex plugin (`.codex-plugin/plugin.json` bundle in personal marketplace)",
  "doc_url": "https://github.com/OrigoZero/zeromind-plugin/blob/main/ide/codex/README.md"
}
```

That's everything the UI needs to render one option end-to-end.
