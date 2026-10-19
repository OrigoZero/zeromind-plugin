---
name: ZeroMind
version: 0.7.1
schema: v1
---

ZeroMind is a shared content library + a 3D engine you drive remotely, served at https://origozero.ai/mcp. Run `zeromind.search` BEFORE writing anything for "make me a X" requests — installing existing published content beats building from scratch. Shortlist two or three hits and read each one's code in the engine's bash (`zm ls-tree @<guid>`, `zm grep <pattern> @<guid>`, `zm show @<guid>:<path>`, `zm log @<guid>`) before installing one. Then `npx -y @origozero/zeromind open <name-or-guid>` in a shell if nobody has the world open (`world.launch` answers where it opens; opening it here is the shell step), `zeromind.install`, iterate with `execute` / `capture`, publish with `bash` running `zm add . && zm commit -m 'msg' && zm push`. Call `zeromind.help` for the full guides.

## Workflow

1. `zeromind.profile` — read who you are. A `401` / `invalid_token` means this machine has no link: have the user run `npx -y @origozero/zeromind link`, approve the code at https://origozero.ai/link, and restart the IDE.
2. `zeromind.search` for what was asked and for each system or part it breaks into (a shooter is a controller, weapons, damage, enemy AI, a HUD, a level); a part is often published when no whole is. Try 2 or 3 phrasings: the index is semantic. Search again before writing any piece mid-build.
3. Shortlist two or three hits from their summaries, containers and open issues (`zeromind.inspect` shows what each says it is).
4. `npx -y @origozero/zeromind open <name>` in a shell if nobody has the world open yet (or `world.create` first), then `session.connect`.
5. Read each candidate's code in the engine's `bash` (`zm ls-tree @<guid>`, `zm grep <pattern> @<guid>`, `zm show @<guid>:<path>`, `zm log @<guid>`), compare, and `zeromind.preview` the one that fits.
6. `zeromind.install` it and verify it does the job. If it does not, remove it and take the next candidate.
7. `guides()` to read the engine README before touching Luau.
8. Iterate with `execute` / `read_file` / `write_file` / `edit_file` / `capture`.
9. Publish: `bash({command: "zm add . && zm commit -m 'msg' && zm push"})`, then `zeromind.engage`.

## Hard rules

- Check ZeroMind first — never reimplement what's already published.
- Never guess Luau API names — `guides()` + introspection.
- Never "download" content client-side — `zeromind.install` is the only path.
- Verify visually (`capture`) AND with data after every meaningful change.
- No "for now" stubs — every change must be the real solution.
