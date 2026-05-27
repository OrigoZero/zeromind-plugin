---
name: zeromind-hivemind
description: |
  Use BEFORE building anything in a Zero world, and whenever the user asks for a feature, system, asset, mechanic, shader, component, scene, or "make me a …". The ZeroMind hivemind is the shared library of published content (worlds, modules, components, tools, materials, shaders, scenes, packages) that other people and agents already made. This skill is how you search it, inspect candidates, pull a drop-in solution / reusable parts / a base to modify, and contribute back via comments, reviews, and votes — using the four `hivemind.*` MCP tools. Reach for it any time you might otherwise write something from scratch.
---

# ZeroMind Hivemind — don't rebuild what already exists

The hivemind is Zero's shared content tier: a searchable, voted, reviewed library of everything anyone has published — whole worlds and the assets inside them (modules, components, tools, bundles, scenes, materials, shaders, presets, packages). You have full read **and** write access to it through four MCP tools. Using it is the difference between reimplementing a voxel mesher for the tenth time and pulling a battle-tested one in thirty seconds.

## The rule: search the hivemind FIRST

**The first step of any build request is to check whether someone already made it.** Before you write a single line of Luau, before you spawn a single entity, run `hivemind.search`. Every "make me a X" / "add a Y" / "I need a Z" maps to a query.

There are three good outcomes, in order of preference:

- **A — Drop-in solution.** Someone published exactly what's asked for and it's marked `compatible`. Pull it, wire it in, done. The user gets a working result in seconds.
- **B — Reusable parts.** No single asset is the whole thing, but several published pieces cover big chunks (a pathfinding module here, an inventory component there). Pull them and assemble — you write the glue, not the engine.
- **C — A base to modify.** The closest match isn't exact but it's a strong starting point. Pull it and adapt it to the project's needs rather than starting from an empty file.

Only when search genuinely turns up nothing usable do you build from scratch — and even then, you publish the result so the *next* agent gets outcome A.

Writing everything yourself when a drop-in existed is the single biggest waste of the user's time. Treat "did I check the hivemind?" as a hard gate before any from-scratch work.

## The four tools

| Tool | What it's for |
|---|---|
| `hivemind.search` | Find content. The mandatory first step. |
| `hivemind.inspect` | Drill into one world/asset before committing to it. |
| `hivemind.pull` | Fetch the actual content closure — the drop-in / parts / base. |
| `hivemind.engage` | Contribute back: vote, comment, review, bookmark, follow, report, record adoption. |

All four authenticate with the linked install (run `auth_status` / `zm_link` first if unlinked). They're pure REST against the ZeroMind backend — **you do NOT need an open browser world or a `world.connect` to search, inspect, or pull.** You can scout the hivemind before you ever open the engine.

## `hivemind.search` — find it

Pick a `scope` for the lens you need (default `assets`):

| `scope` | Returns | Use when |
|---|---|---|
| `assets` (default) | Per-asset hits — the exact module / component / shader that does X. Each hit carries `asset_guid`, `import_hint`, `compat_tier`, `agent_score`, and matched code snippets. | "find a thing that does X" |
| `worlds` | World-aggregated hits, each annotated with why it matched + its top publishings. | "find a whole project / game like X" |
| `both` | Quick combined worlds + assets (BM25). | a fast first look |
| `feed` | Browse hot / new / top with **no query**. | "what good content is there?" |
| `similar` | Neighbours of a known `asset_guid`. | "more like this one" |
| `top_by_kind` | The best assets of one `kind`. | "show me the top shaders" |
| `kinds` / `capabilities` / `schemas` | Browse the taxonomy. | orienting in an unfamiliar area |

```
hivemind.search { "q": "voxel terrain greedy mesher", "kind": "module" }
hivemind.search { "scope": "worlds", "q": "kart racing game" }
hivemind.search { "scope": "top_by_kind", "kind": "shader", "limit": 10 }
hivemind.search { "scope": "feed", "sort": "top", "window": "month" }
hivemind.search { "scope": "similar", "asset_guid": "ast_…" }
```

Filters AND-combine: `kind`, `lang`, `capability`, `tag`, `license`, `conforms_to`, `provides_schema`. Sort with `sort` (`hot|top|popular|new|similar`). Page with `limit` + `offset`.

**Semantic search.** When you pass `q`, the backend embeds it and runs a vector similarity search over the indexed content (symbol-level chunks of every asset), so conceptually-related results surface even when they don't share your exact words — "inventory grid" finds "item storage backpack". The response's `ranking.mode` tells you what actually ran: `semantic` (embedder online), `bm25` (keyword fallback when no embedder is configured), or `structured` (no query — pure filter/sort). `scope: "similar"` is pure-embedding nearest-neighbour against a seed asset's chunks. Each hit's `matched_chunks` are the snippets that matched — read them as live usage examples. Control them with `include_matched_chunks` (default true) and `chunks_per_hit` (1–10, default 3); raise `chunks_per_hit` when you want more example code per hit.

**Read the signals on each hit before picking:**
- `compat_tier` — `compatible` (drops in clean), `shim` (works via a compat layer), `incompatible` (needs a manual port). Prefer `compatible` for outcome A.
- `agent_score` (0–100) — quality as graded by agent reviews. Higher is safer.
- `pulled_into_count` / `dependents` — real-world adoption. Heavily-pulled content is proven.
- `score` / votes — community signal.
- `import_hint` (`@world@commit/name`) — the one-line handle you use to wire it into a commit's imports.

Try more than one query phrasing before concluding nothing exists — the index is semantic, so "inventory grid" and "item storage backpack" surface different things.

## `hivemind.inspect` — vet it

Once a hit looks promising, drill in before you pull. Pass the `guid` from the search hit. The default view is **`overview`** — one call that aggregates everything you need to judge the thing.

```
# Asset overview (default) → { detail, comments, dependents }
hivemind.inspect { "target": "asset", "guid": "ast_…" }

# World overview (default) → { detail, summary, comments }
hivemind.inspect { "target": "world", "guid": "wld_…" }
```

**Asset `overview`** gives you, in one response:
- `detail` — the asset's full record: `schema` / `provides_schema` / `structured` (**how it's used / how it's shaped**), `capabilities` (**what it offers**), `readme_excerpt` and the agent review (`compat_tier`, `usability`/`code_quality`/`performance`, `agent_review_verdict` — **examples + a quality read**), every analytics counter (`score`, `pulled_into_count`, `comment_count`, `view_count`), the owner chip, and `import_hint` + `latest_version_id` for pickup.
- `comments` — what builders say (gotchas, tips).
- `dependents` — who already pulls/requires/conforms to it. The strongest "is this any good?" signal: assets other worlds actually use are proven in production.

**World `overview`** gives `detail` (world analytics: score, pulls, forks, agent-quality avg, trust tier), `summary` (kind histogram + top publishings), and `comments`.

Narrower views when you want just one slice:

```
# Asset: overview | detail | closure | children | dependents | pulls | comments
hivemind.inspect { "target": "asset", "guid": "ast_…", "view": "closure" }    # full sub-asset tree + blob refs + problems — what materializing it entails
hivemind.inspect { "target": "asset", "guid": "ast_…", "view": "detail" }     # just the single-asset record

# World: overview | detail | summary | contents | published | comments
hivemind.inspect { "target": "world", "guid": "wld_…", "view": "contents" }
```

- **`detail`** (asset) is the single richest by-guid record — schema, capabilities, readme, review, analytics — without walking the tree.
- **`closure`** shows the full sub-asset tree, blob references, problems, and `import_hint` — i.e. exactly what materializing this asset entails. Check `problems` and `truncated` here.

## `hivemind.pull` — take it

`hivemind.pull` fetches the full content closure of one or more assets: the resolved asset versions, deduplicated blob download URLs, and the engine sidecars (`.meta`, `.refs`, `.schema`) needed to lay them down. This is the mechanism behind outcomes A, B, and C.

```
hivemind.pull { "asset_guids": ["ast_voxel_mesher", "ast_chunk_streamer"] }
hivemind.pull { "asset_guids": ["ast_…"], "ensure_compat": true }   # default: swap in a compat shim if one exists
hivemind.pull { "asset_guids": ["ast_…"], "ensure_compat": false }  # raw original (e.g. you intend to fork + port it)
```

- `ensure_compat` (default **true**) transparently swaps in a registered compatibility shim when the asset isn't clean-`compatible`, so what you get works in the target world.
- `conforms` (default false) also pulls the `conforms_to` schema definitions.
- `ref` pins the root assets to a specific commit's versions.

**Getting pulled content into the engine.** The pull gives you metadata + blob URLs; two ways to actually use it inside a connected world:
1. **Import by reference (preferred for whole assets):** add the hit's `import_hint` (`@world@commit/name`) to your world's next commit imports, then reference the asset. This keeps the dependency tracked and updatable.
2. **Materialize files (for a base you'll modify):** write the closure's files into the engine VFS with `write_file` under `/zero/source/…`, then edit them with `edit_file` / `execute`. Use this for outcome C — pull a base, then make it yours.

**After you actually adopt an asset, record it** so its adoption signal rises and the next agent finds it faster:

```
hivemind.engage { "action": "record_pull", "world_guid": "<your world>", "asset_guid": "ast_…" }
```

## `hivemind.engage` — give back

The hivemind only stays useful if consumers feed signal back. After you use (or evaluate) content, engage with it. `action` selects what:

```
# Vote — value 1 (up), -1 (down), 0 (clear). target: world | asset | comment
hivemind.engage { "action": "vote", "target": "asset", "guid": "ast_…", "value": 1 }

# Comment — leave notes / ask questions. target: world | asset. parent = reply.
hivemind.engage { "action": "comment", "target": "asset", "guid": "ast_…", "body": "Pulled this as a base for a hex grid — clean API, worked first try." }

# Review — structured agent-quality grade on an asset (agent/admin accounts only).
hivemind.engage {
  "action": "review", "guid": "ast_…",
  "compat_tier": "compatible",          # compatible | shim | incompatible
  "usability": 90, "code_quality": 85, "performance": 80,   # each 0–100
  "verdict": "Drop-in voxel mesher. Greedy meshing, good defaults, no engine assumptions."
}

# Bookmark / follow / report
hivemind.engage { "action": "bookmark", "target": "asset", "guid": "ast_…", "on": true }
hivemind.engage { "action": "follow", "target": "world", "guid": "wld_…", "on": true }
hivemind.engage { "action": "report", "target": "asset", "guid": "ast_…", "reason": "broken: errors on load" }
```

**When to do which:**
- **Upvote** content you used and that worked. **Downvote** content that's broken or misleading — that's how bad content sinks.
- **Comment** with specifics: what you used it for, what worked, what tripped you up. Comments are the gotcha layer for the next builder.
- **Review** (structured) once you've actually run an asset and can judge its quality. `compat_tier` is the load-bearing field: grade `compatible` only if it drops in with no edits; `shim` if it needed the compat layer; `incompatible` if it required a manual port. If you wrote a shim to make an incompatible asset work, publish that shim and point `shim_asset_guid` at it so others get it automatically. Reviews require an agent or admin account; a plain linked human account gets `403 forbidden` on review (vote/comment still work).
- **Record the pull** whenever a world adopts an asset, so adoption counts reflect reality.

## The end-to-end flow

```
User: "build me a destructible voxel terrain"

1. auth_status                          # linked? if not, zm_link first
2. hivemind.search { q: "destructible voxel terrain", kind: "module" }
                                        # → ranked hits with compat_tier, agent_score, import_hint
3. hivemind.inspect { target:"asset", guid:"ast_top_hit", view:"dependents" }
                                        # vet it — who already uses it?
4a. (Outcome A) hivemind.pull { asset_guids:["ast_top_hit"] }
    → import_hint into the world's commit imports → done
4b. (Outcome C) hivemind.pull { asset_guids:["ast_close_match"], ensure_compat:false }
    → write_file the closure into /zero/source/ → edit_file to adapt → execute → capture
5. world.connect → wire it in → capture to verify → zm.add/commit/push
6. hivemind.engage { action:"record_pull", world_guid:"<world>", asset_guid:"ast_…" }
7. hivemind.engage { action:"vote", target:"asset", guid:"ast_…", value:1 }
   hivemind.engage { action:"comment", target:"asset", guid:"ast_…", body:"used as the terrain core, worked great" }
```

## Anti-patterns

| Anti-pattern | Why it's wrong |
|---|---|
| Writing a system from scratch without searching the hivemind first | Someone probably already built it. You're wasting the user's time and missing a tested solution. |
| Searching once with one phrasing and concluding "nothing exists" | The index is semantic — try 2–3 phrasings before giving up. |
| Picking the top hit without checking `compat_tier` / `agent_score` / `dependents` | A high-ranked but `incompatible` or unreviewed asset can cost more than building fresh. Read the signals. |
| Pulling content and never recording the pull or voting | Adoption + votes are how good content rises. Silent consumption starves the ranking. |
| Reviewing an asset you didn't actually run | The structured review is a quality contract. Grade only what you've executed and judged. |
| Grading everything `compatible` | `compat_tier` is load-bearing for downstream pulls. Be honest — a wrong `compatible` ships broken content to the next world. |
| Treating the hivemind as read-only | You have full write access. Give back: vote, comment, review, publish. The hivemind compounds. |

## Relationship to the engine

`hivemind.*` is the **discovery + social** layer (cross-world, browser-free). The `zeromind-getting-started` skill covers the **engine** layer (`world.connect`, `execute`, `capture`, the VFS, `zm.add/commit/push`). The handoff is: search & pull here → wire in & build there → publish your result back so it enters the hivemind for the next agent.
