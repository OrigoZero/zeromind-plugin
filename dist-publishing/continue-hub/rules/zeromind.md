---
name: ZeroMind
version: 0.5.0
schema: v1
---

ZeroMind is a shared content library + a 3D engine you drive remotely. Run `zeromind.search` BEFORE writing anything for "make me a X" requests — installing existing published content beats building from scratch. Then `world.connect`, `zeromind.install`, iterate with `execute` / `capture`, publish with `zm.add` / `commit` / `push`. Call `zeromind.help` for the full guides.

## Workflow

1. `auth_status` — if unlinked, walk the user through `zm_link` → open https://origozero.ai/link → enter the code → poll `zm_link_poll`.
2. `zeromind.search` for what was asked. Try 2–3 phrasings — the index is semantic.
3. `zeromind.inspect` the best hit (overview).
4. `world.connect { name, auto_launch: true }` (or `world.create` first).
5. `zeromind.install` the chosen content.
6. `guides()` to read the engine README before touching Luau.
7. Iterate with `execute` / `read_file` / `write_file` / `edit_file` / `capture`.
8. Publish: `execute({code: "zm.add('.'); zm.commit('msg'); zm.push()"})`, then `zeromind.engage`.

## Hard rules

- Check ZeroMind first — never reimplement what's already published.
- Never guess Luau API names — `guides()` + introspection.
- Never "download" content client-side — `zeromind.install` is the only path.
- Verify visually (`capture`) AND with data after every meaningful change.
- No "for now" stubs — every change must be the real solution.
