---
name: zeromind-getting-started
description: |
  Use whenever the user mentions Zero engine, ZeroMind, worlds, the zeromind plugin, or asks to build/edit/render anything in a Zero world — even if they don't name the skill. The complete reference for building in Zero from inside your IDE: account linking, world create/list/connect/launch, the execute → capture loop, API discovery via guides + lsp + introspection, the VFS, capturing screenshots, scenes and worlds, publishing, and the anti-patterns to avoid.
---

# ZeroMind for IDEs

You drive the user's Zero engine remotely through this MCP plugin. The Zero engine is a production-grade 3D engine that runs in the user's web browser at https://origozero.ai — the user opens a world, the plugin's WebSocket bridge attaches your tool calls to that running engine, and you build alongside them in real time.

Treat the engine accordingly: **no shortcuts, no "for now" solutions, no stubs**. Every change must be the real solution.

## STEP 0 (do this first, always): check ZeroMind

**Before building anything, search ZeroMind for content someone already published.** ZeroMind is not just where your work is saved — it's a shared library of worlds and assets (modules, components, tools, materials, shaders, scenes, packages) that other people and agents made and that you can reuse. The first step of *any* project or request is to check whether it already exists.

Run `zeromind.search` before you write a line of Luau. There are three winning outcomes:

- **A — Drop-in solution:** exactly what's asked for, marked `compatible`. Install it, done.
- **B — Reusable parts:** several published pieces cover big chunks — install them and write only the glue.
- **C — A base to modify:** the closest match is a strong starting point — install it and adapt instead of starting empty.

Only build from scratch when search genuinely turns up nothing usable — and then publish the result so the next agent gets outcome A.

```
zeromind.search { "q": "<what the user asked for>", "kind": "<module|component|shader|scene|…>" }
```

The ZeroMind tools — `zeromind.search` (find), `zeromind.inspect` (vet), `zeromind.install` (bring into the world), `zeromind.engage` (vote/comment/review/give back). `search`, `inspect`, and `engage` are pure REST and need **no open world** — you can scout before you ever open the engine; `zeromind.install` is the one that brings content into the connected world (the engine fetches the bytes — you never download content or hand-write guids into `execute()`). **The dedicated `zeromind-library` skill is the full reference for this — read it whenever a request might be served by existing content (i.e. almost always).** Treat "did I check ZeroMind?" as a hard gate before any from-scratch work.

## Core principles

- **`guides` is the canonical reference for everything in-engine.** Whenever you need to know how an engine API works, what assets exist, how content composes, what a system or topic guide says — call `guides`. The content in this skill is a thin orientation layer; the engine's own docs are the source of truth and stay current as the engine evolves. **When this skill and `guides` disagree, `guides` wins.**
- **Verify everything twice — once with data, once visually.** Code that returns the right value is not done. Code whose effect you have screenshotted and re-queried is done.
- **Iterate via the VFS, not via reloads.** The engine hot-reloads Luau, YAML, WGSL, and Markdown writes. Asking the user to reload the browser to "fix" something is almost always a sign you skipped a step.
- **Discover APIs — never guess.** You have `guides`, `lsp.*`, `/zero/docs/api/`, live `_G` introspection — and the public API's source itself, plain Luau you can grep at `/zero/source/libs/@builtin/modules/api/`. Hallucinated function names waste time and break the user's trust. If you don't know whether a function exists, look it up before calling it.
- **Generic over specific.** When you build content, ask whether the underlying capability is generic. Don't accumulate one-off features.

## First-time link (one-time per IDE install)

If `auth_status` returns `linked: false`:

1. Call `zm_link`. Returns either `{status: 'approved', user_id}` (done) or `{status: 'pending', user_code, verification_url, expires_in, interval}`.
2. If pending, tell the user: *"Open **https://origozero.ai/link** and enter `<user_code>`. The code expires in `<expires_in>`s."*
3. Poll `zm_link_poll` every `interval` seconds. When approved, confirm and proceed.

**Always tell the user `https://origozero.ai/link`** as the URL — do not relay the `verification_url` field verbatim. The backend currently returns an `api.origozero.ai/link` variant in that field, but the public approval page lives at `origozero.ai/link`. Use the public domain so the user reaches the right page.

This persists to the OS user-config dir (mode 0600). Subsequent sessions reuse it silently.

## Update check (first `auth_status` of a session)

`auth_status` also returns an `update` object from a one-time, best-effort check against npm (memoized per session — it costs one round-trip on your first call and is free thereafter). When `update.update_available` is true:

1. Tell the user a newer ZeroMind release is available (`update.current` → `update.latest`).
2. Relay `update.how_to_update` and **ask whether they want to update** — you can't update the plugin yourself. In Claude Code that's `/plugin` → update the `zeromind` plugin, then restart the IDE so the refreshed skills and MCP server are picked up.

If the check fails (offline / blocked registry) it silently reports `update_available: false` — never block on it.

## The seamless flow

1. **`auth_status`** — confirm linked. If not, link first.
2. **`zeromind.search`** — check whether the thing the user wants (or parts of it) already exists before building. See STEP 0 above and the `zeromind-library` skill. Inspect a hit, then `zeromind.install` a drop-in / parts / base (after connecting a world).
3. **`world.list`** — find by name, or `world.create({name: "..."})` for a new one. Worlds are persistent multiplayer 3D containers; everything you build lives inside one.
4. **`world.connect({guid, auto_launch: true})`** — the one-call attach:
   - Already-open browser tab → returns immediately.
   - Otherwise opens `https://origozero.ai/edit/<guid>` in the user's default browser and long-polls up to 60s for the WASM engine to boot + connect.
   - On timeout → `{ok: false, error: 'no_active_session', url}`. Relay the URL.
5. **`guides()`** (no args) — read the engine README. **Do this every time after `world.connect`** in unfamiliar territory. The README is the highest-signal orientation for the live engine: the core ideas, the survey-first working rhythm, and the index of core-system and topic guides.
6. **Iterate** with `execute` / `read_file` / `write_file` / `edit_file` / `capture` / `bash`. When you installed a base from ZeroMind (outcome C, via `zeromind.install`), read + adapt the installed files here (`read_file` / `edit_file` under `/source/<name>`).
7. **Publish** when ready: `bash({command: "zm add . && zm commit -m 'describe the change' && zm push"})` — add stages, commit checkpoints, push publishes. Then `zeromind.engage` to vote/comment on content you used.

## Worlds, scenes & persistence

A world is the persistent multiplayer container — a **shared, multi-user session at all times**, in edit and play alike. Inside a world live scenes (layers), entities, components, materials, shaders, custom modules — all in the world's virtual filesystem (VFS) at `/zero/`.

**Writes to the world's source are durable the instant you make them** — there is no save step, and they sync to every collaborator live. Content lives in the world's backend, never on the machine. The `core/worlds`, `core/scenes`, and `core/engine` guides cover the model; the `world.*` and `layers.*` namespaces are the surfaces (`lsp.methods("world")` / `lsp.methods("layers")`).

## Working with ZeroMind — the `zm` tool

`zm` is the engine's versioning + publishing surface. It mirrors git verbs, and you drive it the way you drive git — through the engine **bash**: `zm add . && zm commit -m 'msg' && zm push`. Push makes content on a public world available to everyone; unpushed content is available to people with write access running an editor session. The `core/development` guide and `man zm` are the reference.

## Edit mode vs play mode — testing what you built

The engine you're driving always boots in **edit** mode (authoring surface, gameplay paused — agent tool calls require it). To test what you built actually runs, flip into **play** mode and back:

```luau
wld.play()                            -- flip to play mode: gameplay runs, scripts tick, physics simulates
wld.edit()                            -- flip back to edit mode: pause + return to authoring
wld.mode()                            -- query current mode: "edit" | "play"
```

Mode flips are cheap and reversible — there's no rebuild step. After `wld.play()`, take a `capture` to see your world animating; flip back with `wld.edit()` to make changes; repeat. This is the inner loop for verifying behavior beyond static layout.

## `guides` — the canonical reference for everything in-engine

`guides` is the in-engine documentation surface. Use it for **anything** you need to know about the engine that isn't already in this skill:

- **Core-system guides** (`core/<name>`): getting-started, asset-system, components, entities, scenes, engine, worlds, development, multiplayer, tools, scripting-and-tasks, performance, modules-and-services, vfs, discovering
- **Topic guides** (`topics/<name>`): physics, ui, audio, animation, shaders, materials, rendering, render-textures, input, compute
- Via `man`, also: every API namespace, every registered component, every tool, library modules, and the live VFS

`guides { list: true }` enumerates the current catalog — the lists above are a snapshot.

### Three forms — pick whichever fits

```
guides {}                                    -- no args: returns the engine README (mental model + index)
guides { "path": "core/getting-started" }    -- a specific guide (core/<name> or topics/<name>)
guides { "query": "raycast" }                -- ranked full-text search across README + every guide
guides { "list": true }                      -- enumerate every available guide path
```

Once `execute` / `bash` is available, the in-engine `man` builtin covers even more (api, tools, components, runtime entities, registered category-folder assets) because it also consults `/zero/docs/api/`, `/zero/docs/tools/`, `/zero/docs/components/`, and the live VFS:

```
bash { "command": "man" }                    -- equivalent to guides {} (the README)
bash { "command": "man <topic>" }            -- looks across guides + api + tools + components + asset registries
bash { "command": "man /vfs/path" }          -- treat the topic as a VFS path (any file)
bash { "command": "man -s <sec> <topic>" }   -- explicit section (readme | guides | api | tools | components | path | asset)
bash { "command": "man -k <pattern>" }       -- apropos: list topics whose name matches
bash { "command": "man -l" }                 -- list every available manual entry
```

For namespace-shaped sections (`man -s api world` lists `world/commit`, `world/push`, ...), `man` falls back to a directory listing when the topic has no leaf — drill from `world` to `world/push` without guessing the path. Same fallback for bare VFS directories: `man /zero/source/` lists everything under it.

**When you don't know the right topic name:** `guides({query: "..."})` first, then `bash { "command": "man -k <pattern>" }` to find it, then drill in. `guides { list: true }` enumerates what actually exists.

Hand-authored guides may contain occasional stale references. **`lsp.*` + live `_G` introspection are generated from the live registry and are more authoritative than any guide.** If something documented in a topic doesn't exist when you probe `_G` or `lsp.describe`, the guide is out of date.

## The execute → capture loop

Every interaction with the engine follows the same loop: discover what you need, run code with `execute`, screenshot with `capture`, verify both data and visual.

### Discovering APIs (do this BEFORE calling)

Sources of truth, in order of reliability:

1. **The README** — `guides {}` with no args. Highest signal-to-noise on what tools exist. Reach for it when unfamiliar with the area you're touching.
2. **`lsp.*` discovery** — programmatic introspection against the live registry: `lsp.namespaces()`, `lsp.methods("<ns>")`, `lsp.describe("<ns>/<method>")`, `lsp.search("<q>")`, and friends. **You almost never need these by hand**: the LSP fires automatically on every `execute()`, enriching unknown globals, unknown members, and wrong-argument errors with member lists, did-you-mean suggestions, and signatures. Reach for `lsp.*` when you want to enumerate *before* writing code.
3. **Live `_G` introspection** — `execute { code: "return type(_G.<name>)" }`. Fastest check for "does this global exist?".
4. **Grep the API source** — the entire public API is implemented as plain Luau modules under `/zero/source/libs/@builtin/modules/api/`. When you need exact behavior or argument handling, read the module — it's the ground truth behind every doc surface.
5. **The VFS API docs** — `bash { command: "ls /zero/docs/api/" }` then `read_file { path: "/zero/docs/api/<namespace>/<method>" }`. The same registry `lsp.*` queries, rendered as browsable files.

### Automatic LSP enrichment on every `execute()`

The engine runs a static check before any code executes and attaches diagnostics to the response — success path and error path both carry them. Syntax errors, unknown globals, unresolved requires, unknown members (with did-you-mean + member lists), wrong argument counts, unawaited promises, and bad lifecycle signatures all surface without any action from you. Sealed namespaces and runtime-error enrichment cover what the static pass can't reach.

**Strict mode (default on):** any error-severity diagnostic blocks execution — the VM never runs, no mutations land. Inspect the `diagnostics` field on the response to see exactly which lines/symbols caused the block, fix them, and re-execute.

### Running Luau

```
execute { "code": "..." }
```

Long-running code promotes to a task handle instead of blocking; register the non-blocking `watch` tool on the returned `taskId` and end your turn (the blocking `wait` tool covers tasks expected to finish within a hop or two). The tool schemas document the contract.

For the engine's Luau global surface — what namespaces exist and what they do — read the README (`guides {}`) and use the discovery surfaces above. The engine evolves; the live registry is always current.

### Capturing screenshots

Three axes: **WHERE** (`source`: viewport / entity / position / ui_window), **WHAT** (`pass`: final or a diagnostic buffer), and which **LAYERS**. `mode: "collage"` samples over a duration and is **required for anything that moves, rotates, or animates**. The `capture` tool's own schema documents every parameter and the full pass enum; `man capture/oneshot` covers the Luau primitive behind it.

**Screenshots are NEVER same-frame.** Multiple seconds pass between an `execute` and a `capture`. If something should have appeared/disappeared and didn't, the test failed. Never blame "deferred mutations" or "next frame" — the screenshot is taken many frames later. If it's not there, it's broken.

**`pass = "final"` is for aesthetic verification only. For concrete debugging, pick the diagnostic pass that matches your question.** Use `normal` for surfaces/geometry, `depth` for layout/positioning, `motion_vectors` for motion (static = black, moving = colored), `albedo`/`roughness`/`metallic`/`ao`/`emissive` for material params, `shadow` for lighting attribution. Each renders a known encoding so the answer is unambiguous in one frame.

### The VFS

The engine exposes its **entire state** through a virtual filesystem at `/zero/` — a real codebase you `ls`/`rg`/`cat` over with `bash`. Authored content lives under `/zero/source/`, live state under `/zero/runtime/`, generated docs under `/zero/docs/`; the `core/vfs` guide has the model. Registered resource discovery goes through the API (`asset.list` / `asset.inspect` / `tools.list`), not a filesystem projection.

VFS access from tools: `bash`, plus `read_file` / `write_file` / `edit_file` for content.

## Building content

**For the canonical examples + edge cases, call `guides`:**

- Entities + components: `guides({path: "core/entities"})`, `guides({path: "core/components"})`
- Scenes + worlds: `guides({path: "core/scenes"})`, `guides({path: "core/worlds"})`
- Assets + authoring: `guides({path: "core/asset-system"})`
- Materials / shaders / physics / animation / ui / input / compute / rendering / audio: `guides({path: "topics/<topic>"})`

Or `guides({list: true})` to enumerate every available guide.

## Iterating without reloading

This is the pattern that makes Zero work fast.

1. Connect once. Read the README if unfamiliar.
2. Test via `execute()` and `capture()`.
3. Found a bug or want to tweak? Use `write_file` / `edit_file` against the VFS to modify the script in place. Re-execute.
4. Source writes persist automatically — there is no save step. When ready to publish, `bash { command: "zm add . && zm commit -m 'msg' && zm push" }`.

A single connected session can handle dozens of iterations. If you find yourself asking the user to reload the browser between every change, you're doing it wrong.

## What the user actually wants

Most user prompts will be one of these shapes — translate to the standard flow. **For anything that involves building, `zeromind.search` comes first** (see STEP 0):

- **"make me a [game/scene/world] that does X"** → `zeromind.search({q: "X"})` first. Then `world.create`, `world.connect`, `zeromind.install` what fits, and `execute` to assemble + fill the gaps.
- **"add a [feature/system/mechanic]"** → `zeromind.search({q: "[feature]", kind: "module"})` first — `zeromind.install` a module/component if one exists, then wire it in. Only hand-write it if nothing usable turns up.
- **"open my [name]"** → `world.list` → find by name → `world.connect`.
- **"add a [thing]"** to an open world → `execute` to spawn/configure, `capture` to verify, then `zm add . && zm commit -m '...' && zm push` once happy.
- **"what does my world look like?"** → `capture()` and show them.
- **"does it actually work?"** → `wld.play()` to flip into play mode, `capture` to see it run, `wld.edit()` to return.
- **"save my work"** → `bash({command: "zm add . && zm commit -m '...' && zm push"})`.
- **"the [thing] isn't working"** → `capture` with a diagnostic pass to localize, then `read_file` the relevant component/material, then fix via `edit_file` and re-`execute` / `capture`.

## Errors you'll see

- `link_required` — start the `zm_link` flow.
- `not connected` — call `world.connect` first (no current session attached).
- `forbidden` — you're trying to drive a session that doesn't belong to the linked user.
- `no_active_session` (`world.connect`) — long-poll expired; the user hasn't opened the browser tab. Relay the URL.
- `launch_failed` (`world.connect` with auto_launch) — couldn't spawn the browser; relay the URL manually.
- `lsp.strict: refusing to execute — N error diagnostic(s) found.` — fix the diagnostics in the response's `diagnostics` field, then re-execute. Don't disable strict mode.

## Anti-patterns (avoid these)

| Anti-pattern | Why it's wrong |
|---|---|
| Guessing function names instead of reading the README / `lsp.*` / `man` / the API source when the area is unfamiliar | Hallucinated APIs waste time and break user trust. The README + `lsp.*` are the highest-signal index. |
| Same-frame screenshot reasoning | Multiple seconds pass between `execute` and `capture`. "Deferred mutation" / "next frame" excuses are wrong. |
| Using `pass = "final"` for concrete debugging | Lit captures blend material + lighting + tonemap. Pick the diagnostic pass matching your question. |
| Asking the user to reload the browser to "fix" something | Engine hot-reloads Luau / YAML / WGSL / Markdown. Edit via VFS and re-execute. |
| Disabling `lsp.strict` to silence diagnostics | Strict mode catches your bugs before they corrupt state. Fix the bug, don't silence the check. |
| Stopping at `zm commit` when the goal is publishing | Push is the step that makes content on a public world available to everyone; commits are checkpoints along the way. Finish with `zm add . && zm commit -m '...' && zm push`. |

## Available MCP prompts

This plugin ships ready-made workflow prompts via the MCP `prompts/get` method:

- `getting-started` — same content as this skill, reachable via the prompt protocol.
- `link-this-ide` — the device-code walkthrough.
- `open-and-iterate` — full edit loop, optionally takes `world_name_or_guid` to skip the lookup.
