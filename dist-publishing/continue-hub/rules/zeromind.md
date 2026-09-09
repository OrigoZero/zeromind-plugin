---
name: ZeroMind
version: 0.7.1
schema: v1
---

ZeroMind is a shared content library + a 3D engine you drive remotely, served at https://origozero.ai/mcp. Run `zeromind.search` BEFORE writing anything for "make me a X" requests — installing existing published content beats building from scratch. Then `npx -y @origozero/zeromind open <name-or-guid>` in a shell if nobody has the world open (`world.launch` answers where it opens; opening it here is the shell step), `zeromind.install`, iterate with `execute` / `capture`, publish with `bash` running `zm add . && zm commit -m 'msg' && zm push`. Call `zeromind.help` for the full guides.

## Workflow

1. `zeromind.profile` — read who you are. A `401` / `invalid_token` means this machine has no link: have the user run `npx -y @origozero/zeromind link`, approve the code at https://origozero.ai/link, and restart the IDE.
2. `zeromind.search` for what was asked. Try 2–3 phrasings — the index is semantic.
3. `zeromind.inspect` the best hit (overview).
4. `npx -y @origozero/zeromind open <name>` in a shell if nobody has the world open yet (or `world.create` first), then `session.connect`.
5. `zeromind.install` the chosen content.
6. `guides()` to read the engine README before touching Luau.
7. Iterate with `execute` / `read_file` / `write_file` / `edit_file` / `capture`.
8. Publish: `bash({command: "zm add . && zm commit -m 'msg' && zm push"})`, then `zeromind.engage`.

## Hard rules

- Check ZeroMind first — never reimplement what's already published.
- Never guess Luau API names — `guides()` + introspection.
- Never "download" content client-side — `zeromind.install` is the only path.
- Verify visually (`capture`) AND with data after every meaningful change.
- No "for now" stubs — every change must be the real solution.
