---
name: zeromind-getting-started
description: |
  Use whenever the user mentions Zero engine, ZeroMind, worlds, the zeromind plugin, or asks to build/edit/render anything in a Zero world — even if they don't name the skill. The complete reference for building in Zero from inside your IDE: account linking, world create/list/connect/launch, the execute → capture loop, API discovery via guides + lsp + introspection, the Luau global surface, VFS layout, capturing screenshots with full pass/source/layers control, materials and shaders, scenes and worlds, and the anti-patterns to avoid.
---

# ZeroMind for IDEs

You drive the user's Zero engine remotely through this MCP plugin. The Zero engine is a production-grade 3D engine that runs in the user's web browser at https://origozero.ai — the user opens a world, the plugin's WebSocket bridge attaches your tool calls to that running engine, and you build alongside them in real time.

Treat the engine accordingly: **no shortcuts, no "for now" solutions, no stubs**. Every change must be the real solution.

## Core principles

- **`guides` is the canonical reference for everything in-engine.** Whenever you need to know how an engine API works, what assets exist, how UGC fits together, what a topic / cheatsheet / asset guide says — call `guides`. The content in this skill is a thin orientation layer; the engine's own docs are the source of truth and stay current as the engine evolves. **When this skill and `guides` disagree, `guides` wins.**
- **Verify everything twice — once with data, once visually.** Code that returns the right value is not done. Code whose effect you have screenshotted and re-queried is done.
- **Iterate via the VFS, not via reloads.** The engine hot-reloads Luau, YAML, WGSL, and Markdown writes. Asking the user to reload the browser to "fix" something is almost always a sign you skipped a step.
- **Discover APIs — never guess.** You have `guides`, `lsp.*`, `/zero/docs/api/`, and live `_G` introspection. Hallucinated function names waste time and break the user's trust. If you don't know whether a function exists, look it up before calling it.
- **Generic over specific.** When you build content, ask whether the underlying capability is generic. Don't accumulate one-off features.

## First-time link (one-time per IDE install)

If `auth_status` returns `linked: false`:

1. Call `zm_link`. Returns either `{status: 'approved', user_id}` (done) or `{status: 'pending', user_code, verification_url, expires_in, interval}`.
2. If pending, tell the user verbatim: *"Open `<verification_url>` and enter `<user_code>`. The code expires in `<expires_in>`s."*
3. Poll `zm_link_poll` every `interval` seconds. When approved, confirm and proceed.

This persists to the OS user-config dir (mode 0600). Subsequent sessions reuse it silently.

## The seamless flow

1. **`auth_status`** — confirm linked. If not, link first.
2. **`world.list`** — find by name, or `world.create({name: "..."})` for a new one. Worlds are persistent multiplayer 3D containers; everything you build lives inside one.
3. **`world.connect({guid, auto_launch: true})`** — the one-call attach:
   - Already-open browser tab → returns immediately.
   - Otherwise opens `https://origozero.ai/edit/<guid>` in the user's default browser and long-polls up to 60s for the WASM engine to boot + connect.
   - On timeout → `{ok: false, error: 'no_active_session', url}`. Relay the URL.
4. **`guides()`** (no args) — read the engine README. **Do this every time after `world.connect`** in unfamiliar territory. The README is the highest-signal index for the live engine: mental model, scripting globals, capture parameters, VFS tree, section index pointing to deep topic pagelets.
5. **Iterate** with `execute` / `read_file` / `write_file` / `edit_file` / `capture` / `bash`.
6. **Publish** when ready: `execute({code: "zm.commit('describe the change'); zm.push()"})`.

## Worlds, scenes & persistence

A world is the persistent multiplayer container. Inside a world live scenes (layers), entities, components, materials, shaders, custom modules — all in the world's virtual filesystem (VFS) at `/zero/`.

```
world.guid()                         -- current bound world's guid (nil when unbound)
world.create("name", "Title")        -- mint a new world from the AI flow
world.swap(guid)                     -- switch the engine to a different bound world
world.save("name")                   -- persist EVERYTHING to data/worlds/<name>/
world.load("name")                   -- restore a saved world
scene.save("main")                   -- snapshot the live entity scenegraph
scene.load("alt"); scene.clear()     -- swap scenes; empty
```

## Working with ZeroMind — the `zm` tool

`zm` is the engine's ZeroMind workflow surface. **It mirrors `git` semantics so you don't have to learn anything new** — the verbs are the verbs you already know:

| `zm` command | Maps to (think) | What it does |
|---|---|---|
| `zm.status()` | `git status` | What's changed in the working tree since the last commit. |
| `zm.commit("msg")` | `git commit -am "msg"` | Snapshot the world's current state with a message. Stages + commits in one step. Local to your engine until `push`. |
| `zm.log()` | `git log` | History of commits in the bound world. |
| `zm.diff()` | `git diff` | Working-tree changes since last commit. |
| `zm.push()` | `git push` | Publish committed changes upstream so other players see them. |
| `zm.pull()` | `git pull` | Pull latest committed state from ZeroMind into the working tree. |
| `zm.branch(name)` | `git checkout -b name` | Start a new branch for experimentation. |
| `zm.checkout(ref)` | `git checkout <ref>` | Switch the working tree to a different branch / commit. |
| `zm.reset(ref)` | `git reset` | Drop working-tree changes / move HEAD. |

Two callable forms work everywhere:

- **Inside `execute`:** `execute({code: "zm.commit('msg'); zm.push()"})`.
- **Inside `bash`:** `bash({command: "zm commit -m 'msg' && zm push"})` — the engine's bash surface ships the `zm` command with the same verbs. Use whichever form fits the moment.

For the full vocabulary: `bash { "command": "man zm" }` or `guides({query: "zm"})`.

**Without `zm.push()`, nobody else sees your work.** A commit alone is local to the engine; the push is what reaches the ZeroMind backend and propagates to other clients of the world.

## Edit mode vs play mode

The engine runs in one of two modes:

- **edit** — authoring surface. Gameplay paused. Entities, components, materials, scripts can be added / mutated / removed. This is where `world.create` boots; this is where you build.
- **play** — gameplay running. Player-distribution build. Entities tick, scripts execute their `update()` lifecycle, physics simulates.

Swap between them at runtime to test:

```luau
wld.play()                            -- flip to play mode (start the game)
wld.edit()                            -- flip back to edit mode (pause + return to authoring)
wld.mode()                            -- query current mode: "edit" | "play"
```

Use `wld.play()` to test that what you built actually runs, then `wld.edit()` to keep iterating. Mode flips are cheap and reversible — there's no rebuild step.

**Starting an engine instance in `runtime` mode requires the world to be pushed to ZeroMind first.** When the engine boots with `--profile runtime`, it pulls the world from ZeroMind to play; an unpushed world has nothing to pull. Practical implication: before showing a player your work, you commit + push — **and the push combines all commits since the last push into a single merge** so the published history stays compact. Drafts stay drafts (commit-only) until you decide they're ready to publish (commit + push).

Default boot is `--profile editor` (edit mode); switch with `--profile runtime`. This plugin always works against an `editor`-profile engine because authoring requires it — `runtime` is the player path.

## `guides` — the canonical reference for everything in-engine

`guides` is the in-engine documentation surface. Use it for **anything** you need to know about the engine that isn't already in this skill:

- Engine API namespaces (`asset`, `entity`, `Material`, `Physics`, `scene`, `world`, `compute`, `vfs`, `ui`, `lights`, `cam`, `capture`, `av`, `lsp`, `task`, ...)
- Topic guides (rendering, multiplayer, input, physics, animation, components, scripts, scenes, materials, shaders, UGC, ...)
- Cheatsheets (quick recipes for common tasks)
- Asset guides (what bundled assets exist, how to use them, how to make your own)
- UGC guides (User-Generated Content — how player-authored worlds, modules, scenes, materials are structured + published)
- Component docs (every registered component's properties + lifecycle)
- Tool docs (every registered code-mode tool — what each does + how to invoke)
- The live VFS (what files are in `/zero/source/`, `/zero/runtime/`, the user's world, etc.)

### Three forms — pick whichever fits

```
guides {}                                    -- no args: returns the engine README (mental model + index)
guides { "path": "readme/screenshots" }      -- specific guide under /zero/docs/guides/
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

For namespace-shaped sections (`man -s api world` lists `world/load`, `world/save`, ...), `man` falls back to a directory listing when the topic has no leaf — drill from `world` to `world/save` without guessing the path. Same fallback for bare VFS directories: `man /zero/source/` lists everything under it.

### What to fetch when

| Need | `guides` path | `man` command |
|---|---|---|
| Engine README (mental model + tool table + section index) | `guides {}` | `man` |
| `capture` parameters reference | `readme/screenshots` | `man screenshots` |
| `sim.*` input simulation | `readme/input-sim` | `man input-sim` |
| Edit vs play semantics | `readme/modes` | `man modes` |
| `diagnostics.*` + visual error indicators | `readme/error-checking` | `man error-checking` |
| WORLD_SETTINGS + scene entrypoints + layers | `readme/scene-config` | `man scene-config` |
| Multiplayer relay + sync modes | `readme/multiplayer` | `man multiplayer` |
| What hot-reloads vs what needs reload | `readme/hot-reload` | `man hot-reload` |
| Start-with-exploration + full read/write workflow | `readme/workflow` | `man workflow` |
| Topic guides (rendering / physics / animation / ...) | `topics/<topic>` | `man <topic>` |
| Cheatsheets | `cheatsheets/<name>` | `man <name>` |
| Engine API method | `guides({query: "<method>"})` | `man <namespace>/<method>` or `man -s api <namespace>` |
| Asset guides (the asset catalog) | `topics/assets` | `man assets` |
| UGC guides (user-generated content authoring) | `topics/ugc` | `man ugc` |
| A specific component's docs | — (use `man`) | `man <ComponentName>` |
| A specific tool's docs | — (use `man`) | `man -s tools <tool/name>` |
| Live entity in the running scene | — (use `man`) | `man /zero/runtime/layers/main/entities/<name>` |
| A library module by short name | — (use `man`) | `man <module-name>` (walks `/source/libs/`) |
| A shader's WGSL source | — (use `man`) | `man /zero/source/libs/@builtin/shaders/<name>.shader/shader.wgsl` |

**When the table above doesn't cover what you need:** `guides({query: "..."})` first, then `bash { "command": "man -k <pattern>" }` to find the right topic name, then drill in.

The engine's own `/zero/docs/guides/topics/` and `/zero/docs/guides/cheatsheets/` may contain occasional stale references to APIs that no longer exist. **`guides` results + `lsp.*` + live `_G` introspection are more authoritative than any topic guide.** If something documented in a topic doesn't exist when you probe `_G` or `lsp.describe`, the guide is out of date.

## The execute → capture loop

Every interaction with the engine follows the same loop: discover what you need, run code with `execute`, screenshot with `capture`, verify both data and visual.

### Discovering APIs (do this BEFORE calling)

Sources of truth, in order of reliability:

1. **The README** — `guides {}` with no args. Highest signal-to-noise on what tools exist. Reach for it when unfamiliar with the area you're touching.
2. **`lsp.*` discovery** — programmatic introspection against the live registry; no file parsing, no stale data:
   ```lua
   lsp.namespaces()                     -- { { name, methodCount, hasPublic, hasInternal }, ... }
   lsp.methods("asset")                 -- every entry in a namespace
   lsp.describe("asset/resolve")        -- full info: sig, args, returns, examples, level
   lsp.search("raycast", { limit = 10 }) -- ranked summaries across path/signature/description
   lsp.tools()                          -- code-mode tools (every entry under /docs/tools/)
   lsp.describeTool("scene/spawnLight") -- full tool doc text
   lsp.modules()                        -- library modules (Transform, ComponentView, …)
   lsp.typeOf(expr, ctx_path?)          -- inferred type of any expression
   ```
   **You almost never need these by hand**: the LSP fires automatically on every `execute()` — unknown-global typos, unknown `Foo.bar` access, and wrong-argument errors all come back enriched with method lists, did-you-mean suggestions, and binding signatures. Reach for `lsp.*` when you want to enumerate *before* writing code, or to inspect a single entry in detail.

   **`lsp.typeOf`** is the agent-facing surface to the engine's static type inferer. Pass any Luau expression, get back a structured descriptor: `{ kind, ...fields..., display }`. With no second arg the env is the global ApiDoc snapshot; with a `context_path` the file at that VFS path is parsed and walked first so locals + type aliases are in scope.
3. **Live `_G` introspection** — `execute { code: "return type(_G.<name>)" }`. Fastest check for "does this global exist?". Use whenever a guide or cheatsheet shows an unfamiliar API.
4. **The VFS API docs** — `bash { command: "ls /zero/docs/api/" }` then `read_file { path: "/zero/docs/api/<namespace>/<method>" }`. 300+ method signatures generated from the same registry `lsp.*` queries.
5. **High-level YAML tool definitions** — call the engine's `search_tools` global from inside `execute` when you need to find a registered code-mode tool. Searches `src/lua/code_mode/tools/`. **Note:** this does NOT search the Luau FFI API — for that, use `lsp.search` or the VFS docs.

The engine's own guides (`/zero/docs/guides/topics/...`, `/zero/docs/guides/cheatsheets/...`) contain a small number of stale API examples. **Treat the README, `lsp.*`, and live introspection as more authoritative than the topic guides.** If a function shown in a guide doesn't exist when you probe `_G`, the guide is out of date — use the working alternative.

### Automatic LSP enrichment on every `execute()`

The engine runs `zero_lsp::check_source` before any code executes and attaches diagnostics to the response — success path and error path both carry them. Four mechanisms fire without any action from you:

1. **Pre-execute static check.** Every `execute` request is passed through the LSP first. It catches:
   - Syntax errors
   - Unknown globals — `totalNonsense987()` → error with did-you-mean.
   - Unresolved `require(...)` — any path the VFS can't find.
   - Unknown member on a known namespace — `Material.nonexisting()` → error listing every member + did-you-mean.
   - Unknown member on a proxy return — `entity("ball").isOn = true` → error naming the proxy and listing its members.
   - Unknown member via local binding — `local x = entity(id); x.nonexistent` → same. Tracks single-assignment local types through one level.
   - Unknown member at deep chain — `entity(id).localPosition.invalidMethod` → error naming the parent chain element and its children.
   - Wrong argument count — `compute.createBuffer()` with no args, etc. → `expects at least N, got M. Signature: <sig>`. Colon-call syntax (`x:method(...)`) is normalised.
   - Unawaited promises — `delay(1.0)` without `await(...)` wrapping it.
   - Bad lifecycle-callback signatures — component hooks with wrong arity.
2. **Strict mode (default on).** Any error-severity diagnostic **blocks execution**. The VM never runs, no mutations land. Override per-world by setting `lsp.strict = false` in WORLD_SETTINGS. Turn off the whole pre-check with `lsp.enabled = false`.
3. **Sealed-proxy enrichment.** Every engine namespace table is sealed: reading an undefined field raises an error with the list of actual members and a did-you-mean. Catches paths the static check can't reach (dynamic `ns[computed_name]`).
4. **Runtime error enrichment.** When a Luau error surfaces, the engine scans the message for `ns.method` tokens and appends the binding's signature + argument list under `LSP hint:`. `Material.Create("x")` prints the full `material.create(name, opts)` signature inline, with `Full doc: lsp.describe("Material/Create")` pointer.

The strict-block error looks like:

```
lsp.strict: refusing to execute — 1 error diagnostic(s) found. Set lsp.strict=false in WORLD_SETTINGS to override, or lsp.enabled=false to disable the pre-check entirely.
```

Inspect the `diagnostics` field on the response to see exactly which lines/symbols caused the block.

### Running Luau

```
execute { "code": "local id = sc.spawnModel('cube1', 'cube', 0, 1, 0); return id" }
```

#### Luau globals you'll use most

Quick reference of the engine's Luau surface. **Always verify against `guides` / `lsp.describe` for the current state** — the engine evolves, this table is a snapshot. For any method's full signature + examples, call `guides({query: "<method>"})` or `lsp.describe("<namespace>/<method>")`. For all methods on a namespace, call `lsp.methods("<namespace>")`. **Do not substitute lowercase variants** like `material`, `lighting`, or `physics` — they do not exist as globals.

| Global | Purpose |
|---|---|
| `sc` | Scene shortcut tools: `sc.spawnModel`, `sc.spawnLight`, `sc.spawnCamera`, `sc.spawnText`, `sc.spawnGrid`, `sc.transform`, `sc.move`, `sc.find`, `sc.findAll`, `sc.inspect`, `sc.clear`, `sc.setParent`, `sc.despawn`, `sc.tint`, `sc.outline` |
| `entity(id)` | Proxy: `.id` (stable `ent_xxx`), `.name` (display name, `""` if unnamed), `.localPosition.set/get`, `.rotation`, `.scale`, `.transform.forward/right/up` (read-only world-space dirs from rotation), `.component.add/get/remove/has`, `.rename(new)`, `.setParent`, `.getParent`, `.getChildren`, `.unparent`, `.despawn`, `.bounds()`, `.hierarchyBounds()` |
| `entity.hierarchy.swap(id, asset, opts?)` | Replace a blockout entity with a generated/imported asset, fitting to source bounds. `opts = { fit, source_origin, asset_origin, keep, timeout }`. Returns `(newId, nil)` on success, `(nil, err)` on failure. |
| `entity.spawn(name)` / `entity.spawnAsset(assetId, name)` / `entity.find(name)` / `entity.findAll(name?)` / `entity.exists(id)` / `entity.despawn(id)` | Top-level entity ops |
| `asset` | `asset.register(origin)`, `asset.isLoaded`, `asset.getAssetId`, `asset.compose`, `asset.load`, `asset.loaded`, `asset.inspect(path)` (async), `asset.extractAnimation(assetPath, clipName, outputPath)` (async — extracts .anim from GLB/FBX) |
| `AnimGraph` | `AnimGraph.create(id?)`, `.destroy`, `.addClip(id?, clipPath, opts?)`, `.addMixer`, `.addBlendSpace2D(id?, points)`, `.setBlendSpaceParams(id?, nodeId, x, y)`, `.setOutput(id?, nodeId)`, `.play`, `.stop`, `.setWeight`, `.crossfade(id?, clipPath, duration, looping?)`, `.removeNode`, `.state`. Auto-resolves entity from component context; pass explicit `id` first arg to target a different one. |
| `preset` | `preset.load(name, overrides?)` → plain table for `component.add(...)`. `preset.create(name, entityId, componentType, opts?)` snapshots a live component into a preset asset. |
| `Material` | `Material.Create(name, shader, opts)` (shader properties, `textures`, optional `bindings = { { group=2, binding=N, kind="storage", buffer="compute_buf" } }`), `Material.Apply(entityId, materialName)`, `Material.SetProperty(matName, prop, val)`, `Material.GetProperty(matName, prop)` → any \| nil, `Material.GetPropertyNames(matName)` → {string} \| nil. **PascalCase methods only — lowercase `Material.create` / `material` do NOT exist.** |
| `lights` | `lights.setup({sun, ambient, sky})`, `lights.addPointLight(name, x, y, z, opts)`. **Only two methods — no `setAmbient`/`setDirectional`/`setSky`.** |
| `phys` (tool) | `phys.spawnDynamic`, `phys.spawnStatic`, `phys.addBody`, `phys.addJoint`, `phys.setJointMotor`, `phys.addWheelCollider` — for spawning physics-enabled entities + joints |
| `Physics` (runtime) | `Physics.raycast({ox,oy,oz}, {dx,dy,dz}, dist)`, `.raycastAll`, `.boxCast`, `.sphereCast`, `.overlapSphere`, `.hasLineOfSight`, `.setGravity`, `.getGravity`, `.applyForce/Impulse/Torque`, `.setVelocity`, `.setMass`. **Capital first letter — `phys.raycast` does NOT exist.** |
| `cam` | `cam.lookAt(x, y, z)`, `.frame`, `.get`, `.spawn` |
| `camera` | FFI binding (lower-level than `cam`) |
| `scene` | `scene.save(name?)`, `.load`, `.list`, `.clear`, `.setEntrypoint`, `.mode`, `.play`, `.edit`, `.snapshot.save/load/list`. `scene.save()` with no arg saves the currently active layer. |
| `world` | `world.save(name?)`, `.load`, `.name()`. `world.save()` no-arg saves the bound world AND auto-saves the active scene first. Autosave persists every `edit.auto_save_interval` seconds (default 60) in edit mode. |
| `wld` | `wld.mode`, `.play`, `.edit`, `.loadLayer`, `.hideLayer`, `.showLayer`, `.unloadLayer`, `.layers` |
| `compute` | `compute.registerShader`, `.createBuffer`, `.writeBuffer`, `.writeBufferU32`, `.dispatch`, `.dispatchOnVertices`, `.readBuffer`, `.isReadbackReady`, `.getReadbackResult`, `.getReadbackResultU32`, `.destroyBuffer`, `.destroyShader`. **No `consumeReadback` — use `getReadbackResult`.** |
| `vfs` | `vfs.read`, `.write`, `.remove`, `.mkdir`, `.exists`, `.list`, `.readAsync`. All accept an `opts` table with `root` (default `"/source/"`) so relative paths resolve under it. `vfs.write` overwrites by default; pass `opts.overwrite = false` to refuse to clobber. `vfs.remove` is file-only by default; directories need `opts.recursive = true` and protected roots are always rejected. |
| `gui` | `gui.panel(id, widgets)`, `gui.show`, `gui.hide`, `gui.update` (high-level UI builder) |
| `ui` | `ui.registerScreen(name, tree, layer?)`, `.showScreen`, `.hideScreen`, `.updateScreen`, `.unregisterScreen` (alias `removeScreen`), `.listScreens`, `.getAreaPos(id)` / `.setAreaPos(id, x, y)`, `.response(widgetId)` for per-widget interaction snapshots, `.lastValidation(screenName?)`, `.setTheme`. **Screen lifecycle helpers live in Luau** — `Z.screens` (`modules.zui.screens`): `Z.screens.toggle(name)`, `.exists`, `.visible`, `.list`, `.byName`, `.hideAll`. **Screen tags** — `Z.tags`: `.set(name, {"editor"})`, `.hideByTag` / `showByTag`, `.findByTag`, `.add` / `remove` / `clear` / `get`. **`ui.response(id)`** returns `{ clicked, hovered, focused, changed, value }` — `clicked`/`changed` are *transitions* (true only on the firing frame), `hovered`/`focused` are *current state*. **`ui.lastValidation(name?)`** surfaces validation diagnostics. Validation behaviour is gated by `[ui] validation` in `/zero/WORLD_SETTINGS` (default `"warn"`; `"strict"` rejects on errors; `"off"` skips). Widget-scoped shortcuts: set `shortcut = "Ctrl+S"` on `button`/`iconButton`/`card` to fire onClick on keystroke even when unfocused. |
| `input` | Raw input snapshot + simulation. `input.snapshot()` returns the per-frame state table; `input.isDown(name)` / `input.isAnyDown({names})` are the keyboard-held queries (use these — don't index the snapshot's `keys` by name; `keys` is an ARRAY of pressed key codes, not a dict). Also: `input.events()`, `input.frameId()`, `input.requestPointerLock` / `releasePointerLock`, `input.simulateKeyDown/Up`, `input.simulateMouseDown/Up/Move`, `input.simulateScroll`. The `Zin` library (`require("@builtin::modules.zinput")`) wraps these into a polling/action/binding surface. |
| `sim` | `sim.key`, `.keyDown`, `.keyUp`, `.click`, `.macro` (input simulation) |
| `diagnostics` | `diagnostics.validate`, `.errors`, `.summary` |
| `capture` | `capture.oneshot(opts)` — low-level primitive backing the MCP `capture` tool. `capture.fromEntity(path, opts)`, `capture.fromPosition(path, opts)`, `capture.viewport(path)` — higher-level async helpers for play-mode scripts. |
| `av` | H.264 video encode. `av.status()`, `av.record(path, {frames?, width?, height?, fps?})`, `av.live({...})` → `/engine/live.stream`/nil for the multiviewer UI, `av.stop_live()`, `av.stop_recording(handle?)`, `av.is_live()`, `av.is_recording()`. |
| `mesh` | `mesh.create(name, { positions, indices, normals, uvs })` |
| `log` | `log.info`, `.warn`, `.error`, `.debug` |
| `lsp` | Static analysis surface (see "Automatic LSP enrichment" above and `lsp.*` discovery). |
| `task` | `task.spawn`, `.delay`, `.defer`, `.cancel`, `.wait`, `.await`, `.active`, `.status` |
| `Entity` (capital) | High-level prelude wrappers: `Entity.getPosition`, `.setPosition`, `.patch`, `.snapshot`, `.getComponents` |
| `Transform` (capital) | Math helpers: `Transform.lookAt`, `.lookAtQuat`, `.distance`, `.lerp`, `.orbit`, `.quatFromAxisAngle`, `.quatFromYaw`, `.euler` |
| Globals | `delay(s)` — returns a promise; **use `await(delay(s))` to actually wait**. `await(handle)`, `getTime()`, `print()`, `require()`, `queryEntitiesTable()`, `queryEntitiesFlex()`, `getEntityDetailsTable(id)`, `getCamerasTable()`, `getViewportSize()`, `worldToScreen(x,y,z)`, `screenToWorld(sx,sy)` |

> **LSP fires automatically on every `execute()`.** You do not have to call `lsp.*` by hand. Use `lsp.*` only when checking code you haven't executed yet, enumerating an API up front, or inspecting a specific entry.

### Capturing screenshots

Three axes: **WHERE** (`source`), **WHAT** (`pass`), and which **LAYERS**. Every option flows through to the Luau primitive `capture.oneshot(opts)`.

```
# WHERE — source
capture {}                                                  # default: viewport (on-screen)
capture { "source": "entity",   "entity": "Player", "distance": 8, "angle": [45, 20] }
capture { "source": "position", "position": [0, 10, 20], "lookAt": [0, 0, 0] }
capture { "source": "ui_window", "screen": "system-tools", "window": "system-tools-window" }

# WHAT — pass (diagnostic buffers)
capture { "pass": "normal" }           # world-space normals (geometry sanity check)
capture { "pass": "depth" }            # log-mapped camera distance — fastest layout read
capture { "pass": "albedo" }           # unlit base color
capture { "pass": "shadow" }           # shadow factor, white=lit black=shadow
capture { "pass": "roughness" }        # grayscale
# Full enum: final (default) | albedo | normal | normal_texture | world_normal | depth |
#            linear_depth | roughness | metallic | ao | emissive | tangent | material_flags |
#            shadow | shadow_depth | motion_vectors

# LAYERS
capture { "pass": "normal", "layers": ["scene"] }           # no sky, no post, no UI

# MODES — single or collage (REQUIRED for anything that moves, rotates, or animates)
capture { "mode": "collage", "duration": 2.0 }
capture { "mode": "collage", "pass": "normal", "source": "entity", "entity": "player" }

# Save to disk + downscale cap (disk save stays full-res)
capture { "save_path": "/source/tmp/before.png" }
capture { "max_width": 1024, "max_height": 1024 }
```

Full pass reference + parameter table: `guides { "path": "readme/screenshots" }`.

#### Capturing a single UI window (`source: "ui_window"`)

Renders **one** registered Window widget into its own offscreen RGBA8 texture with a transparent background. The window is drawn fully even when other windows overlap it on the live viewport — captured alone in a fresh egui context. Required: `screen` (the id passed to `ui.registerScreen`) and `window` (the Window widget id inside that tree). `pass`/`fov`/`distance`/`angle`/`layers` are ignored. From Luau the primitive is `ui.captureWindow(screen, window, { width, height }) → { rtHandle, texturePath }`.

Caveats: theme/visuals are seeded from the live context but a window registered in a brand-new offscreen context may render with default-ish colors on the first call (the implementation runs three priming frames per call so a single call is enough; nothing to do). If the window/screen id doesn't exist, the capture writes a transparent PNG and the engine log carries `[GameUI::render_window_to_target] window 'X' not found in screen 'Y'`.

`width` / `height` set output size. In `collage` mode they describe the **total** collage dimensions — cells auto-fit with a 16 px white gutter (no outer border). The plugin's `max_width` / `max_height` default to **1920** (keeps returned images under the API's many-image limit while staying sharp). Pass `0` to disable resize and get native resolution back — note 2560×1440 captures can only be saved via `save_path`, not embedded in the response. Disk saves are always full resolution.

**Screenshots are NEVER same-frame.** Multiple seconds pass between an `execute` and a `capture`. If something should have appeared/disappeared and didn't, the test failed. Never blame "deferred mutations" or "next frame" — the screenshot is taken many frames later. If it's not there, it's broken.

**`pass = "final"` is for aesthetic verification only. For concrete debugging, pick the diagnostic pass that matches your question.** Lit captures blend materials + lighting + tonemapping into colors that are hard to compare against a mental model. Use `normal` for surfaces/geometry, `depth` for layout/positioning, `motion_vectors` for motion (static = black, moving = colored), `albedo`/`roughness`/`metallic`/`ao`/`emissive` for material params, `shadow` for lighting attribution. Each renders a known encoding so the answer is unambiguous in one frame. Mode (still / collage) is independent — pick it for the shape of evidence, not for what you're verifying.

### The VFS

The engine exposes its **entire state** through a virtual filesystem at `/zero/`. Entities are folders. Components are files. Transforms are files you can read and write. Writing a `.component` folder to `/zero/source/<Name>.component/` with an `init.luau` inside registers the component type. The model is: file ops map to engine ops.

```
/zero/
  README                          # Engine index (mental model + tool table + section index)
  source/                         # User + library files (writable workspace)
    test_results.md               # Engine test suite output
    libs/                         # Mounted libraries (@builtin, @physics, ...)
    Foo.component/                # Category-suffixed folders; `cat` for the summary,
    Bar.material/                 # `ls` for the inner files (init.luau, README.md, ...)
    plant.bundle/
    ...                           # Captures, scratch files, user data
  runtime/                        # Live engine state
    WORLD_SETTINGS                # World config (gravity, entrypoint, lsp.*, ui.validation, edit.auto_save_interval)
    STATE                         # Current engine state
    layers/main/entities/         # Live entity scenegraph (per layer, default: main)
      <name>/                     # Entity folder
        id, position, rotation, scale, name
        children/<child-name>     # Hierarchy
        components/<Type>         # Component instances on this entity
    lighting/                     # Current lighting config
    sky/                          # Sky configuration
    render_surfaces/              # Render-to-texture outputs
    generated_meshes/             # Runtime-generated meshes (mesh.create handles)
    logs/script                   # Script execution log
    profiler/                     # Profiler data
    sync/                         # Multiplayer sync state
  docs/
    api/<namespace>/<method>      # 300+ method signatures (live, generated)
    components/                   # Component property docs
    guides/                       # core/, topics/, cheatsheets/
    tools/                        # Tool definitions
```

Registered resource discovery goes through the API, not a filesystem projection:

```lua
asset.list()                      -- every registered identity
asset.list("component")           -- filter by category
asset.list("bundle", "libraries/@builtin")  -- filter by category + scope
asset.inspect("<identity>")       -- identity, guid, source path, usage template
asset.resolve("<identity>")       -- handle { guid, path, identity, category }
tools.list()                      -- every registered workflow tool
```

VFS access from tools:

```
bash       { "command": "ls /zero/runtime/layers/main/entities" }
bash       { "command": "cat /zero/source/Camera.component" }   # same output as asset.inspect("Camera")
read_file  { "path": "/zero/runtime/layers/main/entities/car/position" }   # JSON
write_file { "path": "/source/MyComponent.component/init.luau", "content": "..." }
```

**Write paths**: all writes go to `/zero/source/`. Component files live under `/source/<Name>.component/init.luau`. Materials are `<Name>.material/`, shaders are `.wgsl`, bundles are `<name>.bundle/`. The engine auto-registers them — `asset.list()` / `asset.inspect()` confirms.

**Engine doc accuracy**: `/zero/docs/guides/` contain occasional stale references to APIs that no longer exist (`material.create` lowercase, `lighting.setDirectional`, `renderTarget.create`, `rendering.setDebugChannel`, `scene.despawnAll`). Always verify a function exists before using it — query `_G[name]` or call `type(_G[name])` from `execute()` if unsure.

## Building content

The snippets below are starting points. **For the canonical examples + edge cases, call `guides`:**

- Entities + components: `guides({path: "topics/entities"})`, `guides({path: "topics/components"})`
- Materials + shaders: `guides({path: "topics/materials"})`, `guides({path: "topics/shaders"})`
- Scenes + worlds: `guides({path: "topics/scenes"})`, `guides({path: "readme/scene-config"})`
- Physics: `guides({path: "topics/physics"})`
- Animation: `guides({path: "topics/animation"})`
- UI: `guides({path: "topics/ui"})`
- Compute shaders: `guides({path: "topics/compute"})`
- Input: `guides({path: "topics/input"})`, `guides({path: "readme/input-sim"})`
- Assets: `guides({path: "topics/assets"})`
- UGC authoring: `guides({path: "topics/ugc"})`

Or `guides({list: true})` to enumerate every available topic.

### Entities & components

```luau
-- Spawn from a procedural primitive (signature: name, source, x, y, z, opts?)
-- Builtin sources: "cube", "sphere", "plane", "cylinder", "cone", "octahedron"
local id = sc.spawnModel("cube1", "cube", 0, 1, 0)
entity(id).localScale.set(2, 2, 2)

-- Spawn with physics
sc.spawnModel("ball", "sphere", 0, 5, 0, { physics = "dynamic" })

-- Add a point light entity (the entity transform sets the light's position)
local lampId = entity.spawn("lamp")
entity(lampId).localPosition.set(5, 3, 0)
entity(lampId).component.add("Light", {
    type = "point", colorR = 1, colorG = 0.8, colorB = 0.6,
    intensity = 2.0, radius = 15,
})

-- Query (position.get returns x, y, z as multiple returns)
local x, y, z = entity(id).localPosition.get()
print(x, y, z)
```

Scene-global lighting uses the `lights` namespace (only two methods):

```luau
lights.setup({
    sun     = { direction = {-0.5, -1, -0.3}, color = {1, 0.95, 0.8}, intensity = 1.2 },
    ambient = { color = {0.4, 0.4, 0.6}, intensity = 0.3 },
    sky     = { enabled = true },
})
lights.addPointLight("lamp", 0, 3, 0, { color = {1, 0.8, 0.5}, intensity = 5 })
```

### Components (custom scripts)

Custom component scripts use `declare()` to bind their fields and lifecycle. Drop them into `/zero/source/<Name>.component/init.luau` — the engine auto-registers and they appear in `asset.list("component")`.

### Materials & shaders

```luau
-- Material.Create — capital C (Material.create lowercase does NOT exist)
Material.Create("my_red", "pbr", { base_color = {1, 0, 0}, roughness = 0.3, metallic = 0.8 })

-- Apply: ENTITY FIRST, material name second. Reversed order will fail.
Material.Apply(id, "my_red")

-- Apply via Material component (also works — use bare material name, not identity path)
entity(id).component.add("Material", { material = "gold" })

-- Per-instance overrides are NOT supported. Material properties are registry-wide.
-- To tweak a property at runtime, edit the material itself (every entity using it updates):
Material.SetProperty("default", "roughness", 0.1)
-- or via the component's :setProperty method
entity(id).component.get("Material"):setProperty("roughness", 0.1)

-- Read back property values / discover the property schema.
-- All PascalCase — Material.getProperty / Material.getPropertyNames (lowercase) do NOT exist.
local r = Material.GetProperty("default", "roughness")     -- → number | nil
for _, p in ipairs(Material.GetPropertyNames("default") or {}) do print(p) end
```

### Scenes & worlds

```luau
-- Snapshot the live entity scenegraph to VFS
scene.save("main")

-- Persist EVERYTHING (VFS, registries, scenes) to data/worlds/<name>/
world.save("my_project")

-- Load a saved world
world.load("my_project")

-- Switch scenes within a world
scene.load("alt_scene")
scene.clear()  -- empty scene

-- Publish — without push, no one else sees your work
execute({ code = "zm.commit('description'); zm.push()" })
```

## Iterating without reloading

This is the pattern that makes Zero work fast.

1. Connect once. Read the README if unfamiliar.
2. Test via `execute()` and `capture()`.
3. Found a bug or want to tweak? Use `write_file` / `edit_file` against the VFS to modify the script in place. Re-execute.
4. When the in-engine state is what you want, persist it: `execute { code: "scene.save('main'); world.save('my_project')" }`.
5. When ready to publish, `execute { code: "zm.commit('msg'); zm.push()" }`.

A single connected session can handle dozens of iterations. If you find yourself asking the user to reload the browser between every change, you're doing it wrong.

## What the user actually wants

Most user prompts will be one of these shapes — translate to the standard flow:

- **"make me a [game/scene/world] that does X"** → `world.create`, `world.connect`, then `execute` + `write_file` to build X.
- **"open my [name]"** → `world.list` → find by name → `world.connect`.
- **"add a [thing]"** to an open world → `execute` to spawn/configure, `capture` to verify, then `zm.commit`+`zm.push` once happy.
- **"what does my world look like?"** → `capture()` and show them.
- **"save my work"** → `execute({code: "zm.commit('...'); zm.push()"})`.
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
| Guessing function names instead of reading the README / `lsp.*` / `bash man` when the area is unfamiliar | Hallucinated APIs waste time and break user trust. The README + `lsp.*` are the highest-signal index. |
| Same-frame screenshot reasoning | Multiple seconds pass between `execute` and `capture`. "Deferred mutation" / "next frame" excuses are wrong. |
| Using `pass = "final"` for concrete debugging | Lit captures blend material + lighting + tonemap. Pick the diagnostic pass matching your question. |
| Substituting lowercase variants like `material.create` or `physics.raycast` | The lowercase globals don't exist. Use `Material.Create` / `Physics.raycast`. |
| Asking the user to reload the browser to "fix" something | Engine hot-reloads Luau / YAML / WGSL / Markdown. Edit via VFS and re-execute. |
| Disabling `lsp.strict` to silence diagnostics | Strict mode catches your bugs before they corrupt state. Fix the bug, don't silence the check. |
| Indexing `input.snapshot().keys` by name | `keys` is an ARRAY of pressed key codes, not a dict. Use `input.isDown("KeyD")`. |
| `entity:component("X")` colon-call instead of `entity.component.X(...)` | Colon-call returns nil silently. Use the dot form. |
| Persisting work without `zm.push()` | Without push, nobody else sees your changes. Always finish with `zm.commit` + `zm.push`. |

## Available MCP prompts

This plugin ships ready-made workflow prompts via the MCP `prompts/get` method:

- `getting-started` — same content as this skill, reachable via the prompt protocol.
- `link-this-ide` — the device-code walkthrough.
- `open-and-iterate` — full edit loop, optionally takes `world_name_or_guid` to skip the lookup.
