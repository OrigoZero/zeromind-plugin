---
name: zeromind-getting-started
description: |
  Use whenever the user mentions Zero engine, ZeroMind, worlds, the zeromind plugin, or asks to build/edit/render anything in a Zero world — even if they don't name the skill. Explains what Zero is and how to drive it via the bundled MCP tools (auth_status, zm_link, world.list/create/connect, execute, guides, capture, read_file, write_file, edit_file, bash, luau_test, instance_health) and the MCP prompts (getting-started, link-this-ide, open-and-iterate, file-engine-bug).
---

# ZeroMind for Claude Code

## What is Zero

Zero is a custom 3D engine with Luau scripting, compiled to native + WASM. Players run worlds in their browser at `https://zeromind.origoclaw.com/play/<guid>`. Everything is organized into **worlds** — persistent, multiplayer containers backed by spacetime + ZeroMind. A world survives restarts, syncs across collaborators, and is the only path through which work reaches players.

You (Claude) talk to the user's currently-open browser tab via this plugin's MCP tools, which route through a ZeroMind-hosted WSS bridge to the WASM engine. You don't run anything locally; the engine is in the browser.

## First time only — link this IDE

If `auth_status` says `linked: false`, run the linking flow:

1. Call `zm_link`. It returns either `{status: 'approved', user_id}` (done) or `{status: 'pending', user_code, verification_url, expires_in, interval}`.
2. If pending, tell the user verbatim:
   > "Open `<verification_url>` in your browser, sign in if needed, and enter `<user_code>`. The code expires in `<expires_in>`s."
3. Poll `zm_link_poll` every `interval` seconds. When it returns approved, confirm to the user and proceed.

This is a one-time setup per IDE install. Subsequent sessions skip this entirely.

## The standard loop

1. `auth_status` — if unlinked, link first (above).
2. `world.list` — find the world by name or guid. Use `world.create({name})` to make a new one.
3. `world.connect({guid})`:
   - If returns `{ok: true, session_id}` — great, you're attached. Proceed.
   - If returns `{ok: false, error: 'no_active_session', url, message}` — relay `url` to the user: "Open `<url>` in a browser tab, then say go." Wait. Retry `world.connect`.
4. **Always call `guides()` (no args) immediately after `world.connect`.** It returns the engine README. The README is the source of truth for Luau API. Never guess API names.
5. Iterate:
   - `execute({code: "..."})` — run Luau.
   - `read_file({path: "/zero/source/..."})` / `write_file` / `edit_file` — engine VFS. Writes trigger importers and live-sync to other players.
   - `capture({})` — screenshot. Returns base64 PNG; IDEs render inline. Verify visual + data, not just code.
   - `bash({command: "..."})` — engine's scene-VFS bash.
   - `luau_test({filter?})` — run the engine test suite.
6. When user wants to publish: `execute({code: "zm.commit('msg'); zm.push()"})`.

## Discovery, not guessing

- API names: `guides()`, `guides({query: "physics"})`, `guides({list: true})`. Also: `execute({code: "return type(_G.cam)"})` to confirm a global exists, `execute({code: "return tostring(_G.entity)"})` for a quick introspect.
- Component fields: `guides({path: "topics/components"})`.
- Compute shaders: `guides({path: "topics/compute"})`.

## Validation rules (every change)

- **Visual AND data.** Don't claim a change works without both a `capture()` showing the expected result AND a data query confirming the underlying state.
- **Test twice.** Run the operation, verify; run it again, verify. First-time success can be lucky.
- **No same-frame screenshots.** Several seconds pass between `execute` and `capture`. Don't claim "deferred mutation" — there isn't one.
- **Clear means clear.** If you "clear the scene" and `capture` shows any visible object, the clear failed.

## Errors you'll see

- `link_required` (any tool, when unlinked) — start the linking flow.
- `not connected` (any engine tool, when no session) — call `world.connect` first.
- `forbidden` (engine tools) — the target session isn't owned by the linked user. Reconnect to the right world.
- `no_active_session` (`world.connect`) — user hasn't opened the browser tab yet.

## Filing bugs

If you hit a bug in the engine that's NOT your task, file it: invoke the `file-engine-bug` MCP prompt with `subsystem` and `summary`. The prompt returns the issue template. Use `gh issue create` with the right labels (`bug` + subsystem + `ai-found`). Do NOT include fix suggestions or root-cause guesses — reproduction + recognition only.

## Useful prompts (MCP `prompts/get`)

This plugin ships four prompts you can grab via the MCP `prompts/get` method:

- `getting-started` — full orientation (same content as this skill, plus the tool surface table).
- `link-this-ide` — the device-code walkthrough.
- `open-and-iterate` — end-to-end edit loop, optionally parameterized with `world_name_or_guid`.
- `file-engine-bug` — issue template for the bug filing flow.
