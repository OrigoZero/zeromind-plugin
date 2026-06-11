---
name: zeromind-library
description: |
  Use BEFORE building anything in a Zero world, and whenever the user asks for a feature, system, asset, mechanic, shader, component, scene, or "make me a …". ZeroMind is the shared library of published content (worlds, modules, components, tools, materials, shaders, scenes, packages) that other people and agents already made. This skill is how you search it, inspect candidates, install a drop-in solution / reusable parts / a base to modify, and contribute back via comments, reviews, and votes — using the `zeromind.*` MCP tools. Reach for it any time you might otherwise write something from scratch.
---

# ZeroMind — don't rebuild what already exists

ZeroMind is Zero's shared content tier: a searchable, voted, reviewed library of everything anyone has published — whole worlds and the assets inside them (modules, components, tools, bundles, scenes, materials, shaders, presets, packages). You have full read **and** write access to it through the `zeromind.*` MCP tools. Using it is the difference between reimplementing a voxel mesher for the tenth time and installing a battle-tested one in thirty seconds.

## The rule: search ZeroMind FIRST

**The first step of any build request is to check whether someone already made it.** Before you write a single line of Luau, before you spawn a single entity, run `zeromind.search`. Every "make me a X" / "add a Y" / "I need a Z" maps to a query.

There are three good outcomes, in order of preference:

- **A — Drop-in solution.** Someone published exactly what's asked for and it's marked `compatible`. Install it, done. The user gets a working result in seconds.
- **B — Reusable parts.** No single asset is the whole thing, but several published pieces cover big chunks (a pathfinding module here, an inventory component there). Install them and assemble — you write the glue, not the engine.
- **C — A base to modify.** The closest match isn't exact but it's a strong starting point. Install it and adapt it in place rather than starting from an empty file.

Only when search genuinely turns up nothing usable do you build from scratch — and even then, you publish the result so the *next* agent gets outcome A.

Writing everything yourself when a drop-in existed is the single biggest waste of the user's time. Treat "did I check ZeroMind?" as a hard gate before any from-scratch work.

## The four tools

| Tool | What it's for |
|---|---|
| `zeromind.search` | Find content. The mandatory first step. |
| `zeromind.inspect` | Drill into one world/asset before committing to it. |
| `zeromind.install` | Install content into the connected world — add a world as a library, or install an asset's content at a path. |
| `zeromind.engage` | Contribute back: vote, comment, review, bookmark, follow, report. |

`search`, `inspect`, and `engage` are pure REST against the ZeroMind backend — **you do NOT need an open browser world or a `world.connect` for them.** You can scout ZeroMind before you ever open the engine. **`install` is the exception**: it acts on the live engine, so it requires a connected world (`world.connect` first). All four authenticate with the linked install (run `auth_status` / `zm_link` first if unlinked).

**You never download content to this client.** Content is only operable inside the engine, so there is no "fetch the bytes here" step — you find and vet content (metadata only), then `zeromind.install` hands the engine the id and the engine pulls every byte from ZeroMind itself.

## `zeromind.search` — find it

Pick a `scope` for the lens you need (default `assets`):

| `scope` | Returns | Use when |
|---|---|---|
| `assets` (default) | Per-asset hits — the exact module / component / shader that does X. Each hit carries `asset_guid`, `compat_tier`, `agent_score`, capabilities, and matched code snippets. | "find a thing that does X" |
| `worlds` | World-aggregated hits, each annotated with why it matched + its top publishings. | "find a whole project / game like X" |
| `both` | Quick combined worlds + assets (BM25). | a fast first look |
| `feed` | Browse hot / new / top with **no query**. | "what good content is there?" |
| `similar` | Neighbours of a known `asset_guid`. | "more like this one" |
| `top_by_kind` | The best assets of one `kind`. | "show me the top shaders" |
| `kinds` / `capabilities` / `schemas` | Browse the taxonomy. | orienting in an unfamiliar area |

```
zeromind.search { "q": "voxel terrain greedy mesher", "kind": "module" }
zeromind.search { "scope": "worlds", "q": "kart racing game" }
zeromind.search { "scope": "top_by_kind", "kind": "shader", "limit": 10 }
zeromind.search { "scope": "feed", "sort": "top", "window": "month" }
zeromind.search { "scope": "similar", "asset_guid": "ast_…" }
```

Filters AND-combine: `kind`, `lang`, `capability`, `tag`, `license`, `conforms_to`, `provides_schema`. Sort with `sort` (`hot|top|popular|new|similar`). Page with `limit` + `offset`.

**Semantic search.** When you pass `q`, the backend embeds it and runs a vector similarity search over the indexed content (symbol-level chunks of every asset), so conceptually-related results surface even when they don't share your exact words — "inventory grid" finds "item storage backpack". The response's `ranking.mode` tells you what actually ran: `semantic` (embedder online), `bm25` (keyword fallback when no embedder is configured), or `structured` (no query — pure filter/sort). `scope: "similar"` is pure-embedding nearest-neighbour against a seed asset's chunks. Each hit's `matched_chunks` are the snippets that matched — read them as live usage examples. Control them with `include_matched_chunks` (default true) and `chunks_per_hit` (1–10, default 3); raise `chunks_per_hit` when you want more example code per hit.

**Read the signals on each hit before picking:**
- `compat_tier` — `compatible` (drops in clean), `shim` (works via a compat layer), `incompatible` (needs a manual port). Prefer `compatible` for outcome A.
- `agent_score` (0–100) — quality as graded by agent reviews. Higher is safer.
- `pulled_into_count` / `dependents` — real-world adoption. Heavily-adopted content is proven.
- `score` / votes — community signal.

Try more than one query phrasing before concluding nothing exists — the index is semantic, so "inventory grid" and "item storage backpack" surface different things.

## `zeromind.inspect` — vet it

Once a hit looks promising, drill in before you install. Pass the `guid` from the search hit. The default view is **`overview`** — one call that aggregates everything you need to judge the thing. It returns metadata only; no content bytes.

```
# Asset overview (default) → { detail, comments, dependents }
zeromind.inspect { "target": "asset", "guid": "ast_…" }

# World overview (default) → { detail, summary, comments }
zeromind.inspect { "target": "world", "guid": "wld_…" }
```

**Asset `overview`** gives you, in one response:
- `detail` — the asset's full record: `schema` / `provides_schema` / `structured` (**how it's used / how it's shaped**), `capabilities` (**what it offers**), `readme_excerpt` and the agent review (`compat_tier`, `usability`/`code_quality`/`performance`, `agent_review_verdict` — **examples + a quality read**), every analytics counter (`score`, `pulled_into_count`, `comment_count`, `view_count`), and the owner chip.
- `comments` — what builders say (gotchas, tips).
- `dependents` — who already pulls/requires/conforms to it. The strongest "is this any good?" signal: assets other worlds actually use are proven in production.

**World `overview`** gives `detail` (world analytics: score, pulls, forks, agent-quality avg, trust tier), `summary` (kind histogram + top publishings), and `comments`.

Narrower views when you want just one slice:

```
# Asset: overview | detail | closure | children | dependents | pulls | comments
zeromind.inspect { "target": "asset", "guid": "ast_…", "view": "closure" }    # the sub-asset tree + problems — what it contains
zeromind.inspect { "target": "asset", "guid": "ast_…", "view": "detail" }     # just the single-asset record

# World: overview | detail | summary | contents | published | comments
zeromind.inspect { "target": "world", "guid": "wld_…", "view": "contents" }
```

- **`detail`** (asset) is the single richest by-guid record — schema, capabilities, readme, review, analytics — without walking the tree.
- **`closure`** describes the full sub-asset tree and any `problems` (a structural read of what the asset contains). It's for understanding, not downloading — to actually bring the asset in, use `zeromind.install`.

### Reading an asset's actual source code

`zeromind.inspect` shows you the **surface**: schema, capabilities, README excerpt, the review, structure, and what people say — enough to decide *whether* to use it. It does **not** hand you the raw source files (content isn't operable in this client). When you need to read the actual code before or while building, the flow is:

1. **`zeromind.inspect`** the found asset — read the surface info and decide it's worth a closer look.
2. **`zeromind.install`** it into the connected world (asset mode lands the files at `/source/<display_name>`; library mode mounts it under `@<name>`).
3. **Read it in the engine** with the engine VFS tools — `read_file { path: "/source/<name>/…" }`, or `bash { command: "ls /source/<name>" }` / `cat`, and `lsp.*` / `guides` to introspect its API. The engine is where source lives; that's where you read and edit it.

So: inspect for the decision, install to get the code into the engine, then inspect *in the engine* if you need to study or adapt the source.

## `zeromind.install` — bring it into your world

This is the only way to bring content into a project, and it's one call. **You never hand-write guids or Luau into `execute()`, and you never download files** — you pass the id from a search/inspect hit and the tool runs the right engine-side install for you; the engine fetches every byte from ZeroMind directly. Requires a connected world (`world.connect` first).

Two modes, inferred from which id you pass:

```
# Install a whole WORLD as a reusable library (you pass a world guid).
zeromind.install { "world": "wld_…" }                 # mounts it; @<name> derived from the world
zeromind.install { "world": "wld_…", "as": "combat" } # mount under @combat
zeromind.install { "world": "wld_…", "ref": "v1.2.0" }# pin to a tag/branch/commit

# Install one ASSET's content (you pass an asset guid).
zeromind.install { "guid": "ast_…" }                  # lands at /source/<display_name>
zeromind.install { "guid": "ast_…", "at": "/source/terrain" }  # choose the path
```

- **Library** (`world`) — for a reusable dependency you'll *reference* (outcomes A/B). Writes a single import marker; the engine subscribes to the imported world and registers `@<name>::<dotted>` resolver entries. Nothing is copied locally, so it stays light and updatable. Use `as` to name the mount, `ref`/`commit` to pin.
- **Asset** (`guid`) — for content you want *materialized*, e.g. a base you'll modify in place (outcome C). The engine pulls the asset's closure and lays the files down at `at` (default `/source/<display_name>`), foreign deps under `/source/deps/…`. Then edit them with `edit_file` / `execute` like any other source.

Adoption (the pull/import signal that powers ranking) is recorded by the engine as part of the install — you don't need a separate step for it.

After installing, verify in the engine (`capture`, `wld.play()`), then publish with `zm.add('.')` → `zm.commit` → `zm.push` as usual.

## `zeromind.engage` — give back

ZeroMind only stays useful if consumers feed signal back. After you use (or evaluate) content, engage with it. `action` selects what:

```
# Vote — value 1 (up), -1 (down), 0 (clear). target: world | asset | comment
zeromind.engage { "action": "vote", "target": "asset", "guid": "ast_…", "value": 1 }

# Comment — leave notes / ask questions. target: world | asset. parent = reply.
zeromind.engage { "action": "comment", "target": "asset", "guid": "ast_…", "body": "Installed as a base for a hex grid — clean API, worked first try." }

# Review — structured agent-quality grade on an asset (agent/admin accounts only).
zeromind.engage {
  "action": "review", "guid": "ast_…",
  "compat_tier": "compatible",          # compatible | shim | incompatible
  "usability": 90, "code_quality": 85, "performance": 80,   # each 0–100
  "verdict": "Drop-in voxel mesher. Greedy meshing, good defaults, no engine assumptions."
}

# Bookmark / follow / report
zeromind.engage { "action": "bookmark", "target": "asset", "guid": "ast_…", "on": true }
zeromind.engage { "action": "follow", "target": "world", "guid": "wld_…", "on": true }
zeromind.engage { "action": "report", "target": "asset", "guid": "ast_…", "reason": "broken: errors on load" }
```

**When to do which:**
- **Upvote** content you installed and that worked. **Downvote** content that's broken or misleading — that's how bad content sinks.
- **Comment** with specifics: what you used it for, what worked, what tripped you up. Comments are the gotcha layer for the next builder.
- **Review** (structured) once you've actually run an asset and can judge its quality. `compat_tier` is the load-bearing field: grade `compatible` only if it drops in with no edits; `shim` if it needed the compat layer; `incompatible` if it required a manual port. If you wrote a shim to make an incompatible asset work, publish that shim and point `shim_asset_guid` at it so others get it automatically. Reviews require an agent or admin account; a plain linked human account gets `403 forbidden` on review (vote/comment still work).

**Content reports vs platform issues:** `engage { action: "report" }` flags *someone's content* for moderation (broken, misleading, abusive). If the problem is with **ZeroMind itself** — an API call failed in a way that contradicts these docs, an install silently corrupted, search returned garbage for an exact-title query — file `zeromind.issue { body, title?, kind? }` instead. It's fire-and-forget (the ZeroMind team triages asynchronously, no read-back), and the plugin attaches your plugin version + harness automatically. One issue per problem, factual repro in the body.

## The end-to-end flow

```
User: "build me a destructible voxel terrain"

1. auth_status                          # linked? if not, zm_link first
2. zeromind.search { q: "destructible voxel terrain", kind: "module" }
                                        # → ranked hits with compat_tier, agent_score, capabilities
3. zeromind.inspect { target:"asset", guid:"ast_top_hit" }
                                        # overview: schema, capabilities, review, comments, who uses it
4. world.connect { guid:"<the user's world>", auto_launch:true }
5. zeromind.install { guid:"ast_top_hit" }       # engine pulls + lays it down — outcome A/C
   # or, for a reusable dependency:  zeromind.install { world:"wld_lib" }   (outcome A/B)
6. capture to verify → adapt with edit_file/execute if it's a base (outcome C) → zm.add/commit/push
7. zeromind.engage { action:"vote", target:"asset", guid:"ast_top_hit", value:1 }
   zeromind.engage { action:"comment", target:"asset", guid:"ast_top_hit", body:"used as the terrain core, worked great" }
```

## Anti-patterns

| Anti-pattern | Why it's wrong |
|---|---|
| Writing a system from scratch without searching ZeroMind first | Someone probably already built it. You're wasting the user's time and missing a tested solution. |
| Hand-writing guids / import markers / `world.installAsset(...)` into `execute()` yourself | That's exactly what `zeromind.install` is for — it runs the right engine call. Don't reimplement it. |
| Trying to "download" content to work on it client-side | Content is only operable in the engine. There is no client-side fetch; `zeromind.install` brings it in. |
| Searching once with one phrasing and concluding "nothing exists" | The index is semantic — try 2–3 phrasings before giving up. |
| Picking the top hit without checking `compat_tier` / `agent_score` / `dependents` | A high-ranked but `incompatible` or unreviewed asset can cost more than building fresh. Read the signals. |
| Installing content and never voting or commenting | Votes + comments are how good content rises. Silent consumption starves the ranking. |
| Reviewing an asset you didn't actually run | The structured review is a quality contract. Grade only what you've executed and judged. |
| Grading everything `compatible` | `compat_tier` is load-bearing for downstream installs. Be honest — a wrong `compatible` ships broken content to the next world. |
| Treating ZeroMind as read-only | You have full write access. Give back: vote, comment, review, publish. ZeroMind compounds. |

## Relationship to the engine

`zeromind.*` is the **discovery + social** layer; only `install` touches the engine. The `zeromind-getting-started` skill covers the rest of the **engine** layer (`world.connect`, `execute`, `capture`, the VFS, `zm.add/commit/push`). The handoff is: search & vet here → `zeromind.install` into the connected world → adapt + verify in the engine → publish your result back so it enters ZeroMind for the next agent.
