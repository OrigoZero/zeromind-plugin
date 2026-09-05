---
name: zeromind-getting-started
description: |
  Use whenever the user mentions Zero engine, ZeroMind, worlds, the zeromind plugin, or asks to build/edit/render anything in a Zero world — even if they don't name the skill. The complete reference for building in Zero from inside your IDE: account linking, world create/list/connect/launch, the execute → capture loop, API discovery via guides + lsp + introspection, the VFS, capturing screenshots, scenes and worlds, publishing, and the anti-patterns to avoid.
---

# ZeroMind for IDEs

You drive the user's Zero engine remotely through the `zeromind` MCP server — ZeroMind itself, at https://origozero.ai/mcp. The Zero engine is a production-grade 3D engine that runs in the user's web browser at https://origozero.ai: the user opens a world, ZeroMind routes your tool calls to that running engine, and you build alongside them in real time.

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

The ZeroMind tools — `zeromind.search` (find), `zeromind.inspect` (vet), `zeromind.preview` (see the exact tree an install would write — every file and dependency with its destination path, size and reason — writing nothing), `zeromind.install` (bring into the world), `zeromind.engage` (vote/comment/review/give back). `search`, `inspect`, and `engage` are pure REST and need **no open world** — you can scout before you ever open the engine; `zeromind.preview` and `zeromind.install` act on the world your engine calls reach (the engine fetches the bytes — you never download content or hand-write guids into `execute()`). Reach for `preview` before `install` when a hit might pull in more than you expect. **The dedicated `zeromind-library` skill is the full reference for this — read it whenever a request might be served by existing content (i.e. almost always).** Treat "did I check ZeroMind?" as a hard gate before any from-scratch work.

`zeromind.help` orients you across the whole toolset, and `zeromind.issue` files a bug or piece of feedback about ZeroMind itself — reach for it when the platform misbehaves rather than working around it silently.

## Core principles

- **`guides` is the canonical reference for everything in-engine.** Whenever you need to know how an engine API works, what assets exist, how content composes, what a system or topic guide says — call `guides`. The content in this skill is a thin orientation layer; the engine's own docs are the source of truth and stay current as the engine evolves. **When this skill and `guides` disagree, `guides` wins.**
- **Verify everything twice — once with data, once visually.** Code that returns the right value is not done. Code whose effect you have screenshotted and re-queried is done.
- **Iterate via the VFS, not via reloads.** The engine hot-reloads Luau, YAML, WGSL, and Markdown writes. Asking the user to reload the browser to "fix" something is almost always a sign you skipped a step.
- **Discover APIs — never guess.** You have `guides`, `lsp.*`, `/zero/docs/api/`, live `_G` introspection — and the public API's source itself, plain Luau you can grep at `/zero/source/libs/@builtin/modules/api/`. Hallucinated function names waste time and break the user's trust. If you don't know whether a function exists, look it up before calling it.
- **A whole job usually already has a skill — open it before improvising a method.** `agent_skill` (no arguments lists the roster; `name` opens one) reaches the **engine's own** skills: packaged procedures for one job, carrying the instructions plus the assets, guides and tools that job runs through. They live in the connected world, not in your host environment, so this tool is the only way to reach one. A skill you open **stays open** and rides your tool responses — address a subskill as `parent/sub`, and `release` it (or `"*"`) when the job is done. This answers a different question from the surfaces below: `agent_skill` is *what job is this*, `guides` is *how does this system work*, a tool is *what operation can I call*.
- **New to a system? Read its guide first.** The guides cover how to approach each part of the engine and route you to the exact reference when you need signatures. Reach for the relevant `guides` before writing raw-API Luau against an unfamiliar area.
- **A tool is a prepackaged `execute()` operation — reach for one before hand-writing it.** Everything you do in the engine runs as Luau; a *tool* is that Luau already written and named, so you don't comb the API by trial and error to redo it. Nothing packaged fits → do it in `execute()`, and if it isn't a one-off, package it as a `.tool` so next time it's one call. `execute` is for complex one-offs; tools are for anything you'll run more than once.

  **Three surfaces reach the same registry — use whichever you already hold:**
  - **`bash`** ships `zero`: `zero` lists every toolbox, `zero <toolbox>` its tools, `zero <toolbox> <tool> --help` one tool's arguments and types, `zero <toolbox> <tool> [args]` runs it, `zero --search <query>` (short: `-k`) keyword-searches. **`--help` answers at every level** (`zero --help`, `zero <toolbox> --help`, `zero <toolbox> <tool> --help`), so you go from "what exists" to a correct call without leaving the shell. Arguments are named (`--fov 60`) or positional; a value that reads as JSON is passed as JSON.
  - **MCP**: `search_tools` (no args lists the toolboxes; `query` searches across them) → `use_tool { toolbox, tool, args }`, with `describe_tool` for one tool's full schema when you know the name and need the exact arguments.
  - **Luau**: `tools.use("<toolbox>", "<tool>", ...)` from inside `execute`.

  **If your harness defers MCP tool schemas, load `search_tools` and `use_tool` before you start** — otherwise you'll hold `execute` and nothing else, and rebuild by hand what a tool already does. `zero` inside `bash` needs no extra schema load, so it is the cheapest way in when only `bash` is loaded.
- **Generic over specific.** When you build content, ask whether the underlying capability is generic. Don't accumulate one-off features.

## Linking this machine (once)

The `zeromind` MCP server is ZeroMind itself at `origozero.ai/mcp`. If its tools answer `401` / `invalid_token`, this machine is not linked yet: tell the user to run

```
npx -y @origozero/zeromind link
```

in a shell, open the URL it prints, and enter the code. Then they restart Claude Code so the new setting is read. Link once per machine — every later session reuses it silently.

## Which engine your calls reach

Engine calls — `execute`, `capture`, `guides`, the VFS tools, `bash` — act on a world's running engine: the browser tab the user has open. **You do not open a session first.** Make the call; if it reports the target is ambiguous, `session.list` shows your engines and `session.connect` pins one. An agent running inside an engine is already bound to that engine and its world, and has no connect tool at all.

A world with nobody in it has no engine to drive: `world.launch` opens it at `https://origozero.ai/edit/<guid>` in the user's browser (`world.open_in_browser` opens a tab on the machine you are running on). If the tab doesn't come up, relay the URL and let the user open it.

## The seamless flow

1. **`zeromind.search`** — check whether the thing the user wants (or parts of it) already exists before building. See STEP 0 above and the `zeromind-library` skill. Inspect a hit, then `zeromind.install` a drop-in / parts / base (after connecting a world).
2. **`world.list`** — find by name, or `world.create({name: "..."})` for a new one. Worlds are persistent multiplayer 3D containers; everything you build lives inside one.
3. **`world.launch`** — if nobody has the world open, this opens it in the user's browser and the WASM engine boots there. A world the user already has open needs nothing.
4. **`guides {}`** (no args) — returns the **guide index** (the README is listed first); then **read the README** with `guides { path: "readme" }`. **Do this every time you start work on a world.** The README is the highest-signal orientation for the live engine: the core ideas, the survey-first working rhythm, and the index of core-system and topic guides. It opens with the one rule that breaks the most builds — **the world is ALWAYS multiplayer:** give players their body/camera/input through the scene's PlayerPrototype, never a hand-rolled player rig (which passes single-peer testing, then breaks the instant a second player joins).
5. **Iterate** with `execute` / `read_file` / `write_file` / `edit_file` / `capture` / `bash`. When you installed a base from ZeroMind (outcome C, via `zeromind.install`), read + adapt the installed files here (`read_file` / `edit_file` under `/source/<name>`).
6. **Publish** when ready: `bash({command: "zm add . && zm commit -m 'describe the change' && zm push"})` — add stages, commit checkpoints, push publishes. Then give the world a face with `edit_world_metadata` (title, description, README body, tags, visibility) and `set_world_cover` (captures the current viewport by default) — a published world nobody can recognise or search for is barely published. Finally `zeromind.engage` to vote/comment on content you used.

## Worlds, scenes & persistence

A world is the persistent multiplayer container — a **shared, multi-user session at all times**, in edit and play alike. Inside a world live scenes (layers), entities, components, materials, shaders, custom modules — all in the world's virtual filesystem (VFS) at `/zero/`.

**Writes to the world's source are durable the instant you make them** — there is no save step, and they sync to every collaborator live. Content lives in the world's backend, never on the machine. The `core/worlds`, `core/scenes`, and `core/engine` guides cover the model; the `world.*` and `layers.*` namespaces are the surfaces (`lsp.methods("world")` / `lsp.methods("layers")`).

## Working with ZeroMind — the `zm` tool

`zm` is the engine's versioning + publishing surface. It mirrors git verbs, and you drive it the way you drive git — through the engine **bash**: `zm add . && zm commit -m 'msg' && zm push`. Push makes content on a public world available to everyone; unpushed content is available to people with write access running an editor session. The `core/development` guide and `man zm` are the reference.

## Edit mode vs play mode — testing what you built

The engine you're driving always boots in **edit** mode (authoring surface, gameplay paused — agent tool calls require it). To test what you built actually runs, flip into **play** mode and back. There are dedicated tools for this:

```
play                       -- gameplay runs: scripts tick, physics simulates, /zero writes lock
edit                       -- back to authoring: gameplay pauses, /zero writes unlock
pause { paused: false }    -- freeze/resume WITHOUT leaving the current mode
```

All three return the resulting run-state `{ mode, paused }`. `execute`'s own response carries `state.mode` / `state.paused` too, so you can read the mode instead of asking for it.

**`play` is refused while user content under `/zero/source` has error-severity LSP diagnostics**, and the refusal names them — fix them rather than working around it.

Mode flips are cheap and reversible; there's no rebuild step. Play → `capture` → `edit` → change → repeat is the inner loop for verifying behavior beyond static layout, and `pause` is how you hold a moving scene still for a clean screenshot.

`wld` is also a **tool toolbox** (never a Luau global) covering the same ground from Luau — `tools.use("wld", "play")` — which is what you want inside a longer `execute` script.

## `guides` — the canonical reference for everything in-engine

`guides` is the in-engine documentation surface. Use it for **anything** you need to know about the engine that isn't already in this skill:

- **Core-system guides** (`core/<name>`): getting-started, asset-system, resource-model, components, entities, ecs, scenes, scenes-as-code, engine, worlds, development, multiplayer, tools, scripting-and-tasks, generating-assets-and-content, requiring-modules, performance, runtime-data, troubleshooting, vfs, discovering
- **Topic guides** (`topics/<name>`): physics, ui, audio, animation, rendering, render-textures, raytracing, input, ik, cutscenes, editor, building-a-game
- **Asset-type references** (`types/<name>`): the canonical reference for each authored asset kind — `types/shader`, `types/material`, `types/component`, `types/module`, `types/scene`, `types/sceneModule`, `types/package`, `types/computeShader`, `types/mesh`, `types/texture`, and the rest. **This is where a thing's property contract lives** — reach for `types/<kind>` before reading source to learn what fields something accepts.
- Via `man`, also: every API namespace, every registered component, every tool, library modules, and the live VFS

`guides { list: true }` enumerates the current catalog — the lists above are a snapshot.

### Three forms — pick whichever fits

```
guides {}                                    -- no args: returns the engine README (mental model + index)
guides { "path": "core/getting-started" }    -- a specific guide (core/<name> or topics/<name>)
guides { "path": "types/shader" }            -- an asset type's own reference (its property contract)
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

For namespace-shaped sections (`man -s api world` lists `world/name`, `world/guid`, `world/participants`, ...), `man` falls back to a directory listing when the topic has no leaf — drill from `world` to `world/participants` without guessing the path. Same fallback for bare VFS directories: `man /zero/source/` lists everything under it.

**When you don't know the right topic name:** `guides({query: "..."})` first, then `bash { "command": "man -k <pattern>" }` to find it, then drill in. `guides { list: true }` enumerates what actually exists.

Hand-authored guides may contain occasional stale references. **`lsp.*` + live `_G` introspection are generated from the live registry and are more authoritative than any guide.** If something documented in a topic doesn't exist when you probe `_G` or `lsp.describe`, the guide is out of date.

## The execute → capture loop

Every interaction with the engine follows the same loop: discover what you need, run code with `execute`, screenshot with `capture`, verify both data and visual.

Before that loop, three questions have cheaper answers than code — **what job is this** (`agent_skill`), **what operation can I call** (a tool), **how does this system work** (`guides`). Reaching for `execute` before asking all three is how an agent rebuilds something the engine already ships.

### Discovering APIs (do this BEFORE calling)

Sources of truth, in order of reliability:

1. **The README** — `guides {}` with no args. Highest signal-to-noise on what tools exist. Reach for it when unfamiliar with the area you're touching.
2. **`lsp.*` discovery** — programmatic introspection against the live registry: `lsp.namespaces()`, `lsp.methods("<ns>")`, `lsp.describe("<ns>/<method>")`, `lsp.search("<q>")`, and friends. **You almost never need these by hand**: the LSP fires automatically on every `execute()`, enriching unknown globals, unknown members, and wrong-argument errors with member lists, did-you-mean suggestions, and signatures. Reach for `lsp.*` when you want to enumerate *before* writing code.
3. **Live `_G` introspection** — `execute { code: "return type(_G.<name>)" }`. Fastest check for "does this global exist?".
4. **Grep the API source** — the entire public API is implemented as plain Luau modules under `/zero/source/libs/@builtin/modules/api/`. When you need exact behavior or argument handling, read the module — it's the ground truth behind every doc surface.
5. **The VFS API docs** — `bash { command: "ls /zero/docs/api/" }` then `read_file { path: "/zero/docs/api/<namespace>/<method>" }`. The same registry `lsp.*` queries, rendered as browsable files.

### Tools first — look before you build

Run the same loop every time you set out to do something in the engine: **check whether a tool already does it — then act.** Found one → run it. Nothing fits → *then* drop to `execute`/`bash` and work against the raw API. The three surfaces that reach the registry are in **Core principles** above; the check is cheap and usually pays off, because the operation you need is often already a validated, one-call tool and reaching for it saves you from reading a subsystem just to reconstruct what it already exposes.

Look two ways — browse the toolboxes (`zero`, or `search_tools` with no arguments, lists them and what each is for) and keyword-search (`zero --search "..."` / `search_tools { query: "..." }`) — because the right tool often lives in a toolbox you wouldn't guess (scene work mostly lives under `sc`, not a "scenes" box). The `core/tools` guide has the full picture, including calling tools from Luau.

**A system's vocabulary is not in the tool registry.** A system's ops, node types and templates live in that system's own registry, reached through its toolbox or its guide — `procgen ops` searches the procedural op registry, and nothing in `search_tools` will surface those ops. So "no tool matched" is not evidence the capability is missing; it usually means the system has not been found yet. Ask the system's `guides` and its own toolbox before concluding you have to build it.

### Automatic LSP enrichment on every `execute()`

The engine runs a static check before any code executes and attaches diagnostics to the response — success path and error path both carry them. Syntax errors, unknown globals, unresolved requires, unknown members (with did-you-mean + member lists), wrong argument counts, unawaited promises, and bad lifecycle signatures all surface without any action from you. Sealed namespaces and runtime-error enrichment cover what the static pass can't reach.

**Strict mode (default on):** any error-severity diagnostic blocks execution — the VM never runs, no mutations land. Inspect the `diagnostics` field on the response to see exactly which lines/symbols caused the block, fix them, and re-execute.

### Running Luau

```
execute { "code": "..." }
```

`execute` returns a structured envelope — `{ result, logs, diagnostics, state }` — where `result` is your return value and `state` snapshots the engine (mode, paused, timeScale, active layer/scene, bound world). The `logs` field is **error-only by default**; pass `logs: "warn" | "info" | "debug"` to surface more (script errors, panics, and diagnostics always surface regardless).

Long-running code promotes to a task handle (`{ status: "running", taskId, ... }`) instead of blocking. Three ways to follow it up:

- The promoting call **auto-registers a watcher** and returns its `fire_path` — read that file any time to check status. Nothing to set up.
- `wait { taskId }` blocks inline, capped at 20s; past that it hands the handle back and you call it again. Right for work finishing within a hop or two.
- For anything longer, read the `fire_path` at the top of a later turn instead of busy-polling `wait`.

For the engine's Luau global surface — what namespaces exist and what they do — read the README (`guides {}`) and use the discovery surfaces above. The engine evolves; the live registry is always current.

### Capturing screenshots

Three axes: **WHERE** (`source`: `main` = the scene/gameplay camera and the default, `editor` = the editor fly-camera, `screen` = the literal on-screen image, `camera` = a specific camera ref, plus `entity` / `position` / `ui_window`), **WHAT** (`pass`: final or a diagnostic buffer), and which **LAYERS**. `mode: "collage"` samples over a duration and is **required for anything that moves, rotates, or animates**. The `capture` tool's own schema documents every parameter and the full pass enum; `man capture/oneshot` covers the Luau primitive behind it.

**`capture` is for the world; `preview` is for one asset.** `preview { asset }` renders a single asset through its type's own `preview()` hook and returns an inline PNG — that's how you look at a mesh, material, texture or scene **without spawning it into the world**. A type with no preview hook answers `available: false` with a reason instead of failing.

**Screenshots are NEVER same-frame.** Multiple seconds pass between an `execute` and a `capture`. If something should have appeared/disappeared and didn't, the test failed. Never blame "deferred mutations" or "next frame" — the screenshot is taken many frames later. If it's not there, it's broken.

**`pass = "final"` is for aesthetic verification only. For concrete debugging, pick the diagnostic pass that matches your question.** Use `normal` for surfaces/geometry, `depth` for layout/positioning, `motion_vectors` for motion (static = black, moving = colored), `albedo`/`roughness`/`metallic`/`ao`/`emissive` for material params, `shadow` for lighting attribution. Each renders a known encoding so the answer is unambiguous in one frame.

### The VFS

The engine exposes its **entire state** through a virtual filesystem at `/zero/` — a real codebase you `ls`/`rg`/`cat` over with `bash`. Authored content lives under `/zero/source/`, live state under `/zero/runtime/`, generated docs under `/zero/docs/`; the `core/vfs` guide has the model. Registered resource discovery goes through the API (`asset.list` / `asset.inspect` / `tools.list`), not a filesystem projection.

VFS access from tools: `bash` for browsing, and `read_file` / `write_file` / `edit_file` for content.

## Building content

**For the canonical examples + edge cases, call `guides`:**

- Entities + components: `guides({path: "core/entities"})`, `guides({path: "core/components"})`
- Scenes + worlds: `guides({path: "core/scenes"})`, `guides({path: "core/worlds"})`
- Assets + authoring: `guides({path: "core/asset-system"})`
- Materials / shaders / physics / animation / ui / input / compute / rendering / audio: `guides({path: "topics/<topic>"})`

Or `guides({list: true})` to enumerate every available guide.

## Iterating without reloading

This is the pattern that makes Zero work fast.

1. Read the README once if you're unfamiliar with the area.
2. Test via `execute()` and `capture()`.
3. Found a bug or want to tweak? Use `write_file` / `edit_file` against the VFS to modify the script in place. Re-execute.
4. Source writes persist automatically — there is no save step. When ready to publish, `bash { command: "zm add . && zm commit -m 'msg' && zm push" }`.

A single connected session can handle dozens of iterations. If you find yourself asking the user to reload the browser between every change, you're doing it wrong.

## What the user actually wants

Most user prompts will be one of these shapes — translate to the standard flow. **For anything that involves building, `zeromind.search` comes first** (see STEP 0):

- **"make me a [game/scene/world] that does X"** → `zeromind.search({q: "X"})` first. Then `world.create`, `world.launch`, `zeromind.install` what fits, and `execute` to assemble + fill the gaps.
- **"add a [feature/system/mechanic]"** → `zeromind.search({q: "[feature]", kind: "module"})` first — `zeromind.install` a module/component if one exists, then wire it in. Only hand-write it if nothing usable turns up.
- **"open my [name]"** → `world.list` → find by name → `world.launch`.
- **"delete my [name]"** → `world.delete({name})` — a reversible soft-delete (recoverable via `world.trash` → `world.restore` for ~30 days, then purged). Confirm with the user first unless they were explicit; you can't delete worlds you don't own.
- **"add a [thing]"** to an open world → `execute` to spawn/configure, `capture` to verify, then `zm add . && zm commit -m '...' && zm push` once happy.
- **"what does my world look like?"** → `capture()` and show them.
- **"does it actually work?"** → `play` to start the simulation, `capture` to see it run, `edit` to return.
- **"save my work"** → `bash({command: "zm add . && zm commit -m '...' && zm push"})`.
- **"the [thing] isn't working"** → `capture` with a diagnostic pass to localize, then `read_file` the relevant component/material, then fix via `edit_file` and re-`execute` / `capture`.

## Errors you'll see

- `401` / `invalid_token` — this machine is not linked; see **Linking this machine** above.
- an ambiguous target — more than one of your engines could serve the call. `session.list` shows them, `session.connect` pins one.
- `no_active_session` — no engine is running for that world; the user hasn't opened the tab. `world.launch` opens it; relay the URL if it doesn't come up.
- `forbidden` — you're trying to drive a session that doesn't belong to the linked user.
- `lsp.strict: refusing to execute — N error diagnostic(s) found.` — fix the diagnostics in the response's `diagnostics` field, then re-execute. Don't disable strict mode.

## Anti-patterns (avoid these)

| Anti-pattern | Why it's wrong |
|---|---|
| Hand-writing an operation in `execute`/`bash` without checking the tool registry first (`zero`, or `search_tools`) | It may already be a packaged tool — one call instead of reconstructing (and debugging) the Luau yourself. |
| Concluding a capability does not exist because no TOOL matched | A system's ops, node types and templates live in that system's own registry, not the tool registry. Ask `agent_skill`, its `guides`, and its own toolbox before deciding you have to build it. |
| Working a multi-step engine job out from first principles without listing `agent_skill` | A skill is the already-correct path for a whole job, and it carries the assets/guides/tools that job runs through. Listing costs one call. |
| Working from `execute` alone because it was the only tool schema your harness loaded | Load `search_tools`/`use_tool`, or reach the same registry through `zero` in `bash`. Holding one tool is not evidence that one tool is the surface. |
| Calling a toolbox as if it were a Luau global (`wld.play()`, `sc.spawn()`) | Toolboxes are not globals. Use `use_tool { toolbox, tool, args }` over MCP, `tools.use("<toolbox>", "<tool>", ...)` in Luau, or `zero <toolbox> <tool>` in `bash`. |
| Reading a shader's or component's source to learn what fields it accepts | The property contract is documented — `guides { path: "types/<kind>" }` for the asset kind, `man <component>` for a component. Read source only when the doc and the runtime disagree. |
| Guessing function names instead of reading the README / `lsp.*` / `man` / the API source when the area is unfamiliar | Hallucinated APIs waste time and break user trust. The README + `lsp.*` are the highest-signal index. |
| Same-frame screenshot reasoning | Multiple seconds pass between `execute` and `capture`. "Deferred mutation" / "next frame" excuses are wrong. |
| Using `pass = "final"` for concrete debugging | Lit captures blend material + lighting + tonemap. Pick the diagnostic pass matching your question. |
| Asking the user to reload the browser to "fix" something | Engine hot-reloads Luau / YAML / WGSL / Markdown. Edit via VFS and re-execute. |
| Disabling `lsp.strict` to silence diagnostics | Strict mode catches your bugs before they corrupt state. Fix the bug, don't silence the check. |
| Stopping at `zm commit` when the goal is publishing | Push is the step that makes content on a public world available to everyone; commits are checkpoints along the way. Finish with `zm add . && zm commit -m '...' && zm push`. |
