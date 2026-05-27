import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";

export const promptDefs: Prompt[] = [
  {
    name: "getting-started",
    description:
      "What is Zero and how do I use this plugin? A short orientation for the AI to read before doing any engine work.",
  },
  {
    name: "find-before-build",
    description:
      "Before building anything, search the ZeroMind hivemind for content that already exists (drop-in solution, reusable parts, or a base to modify). Use at the start of any 'make me a…' / 'add a…' request.",
    arguments: [
      {
        name: "request",
        description: "What the user wants built, in a few words (becomes the search query).",
        required: false,
      },
    ],
  },
  {
    name: "link-this-ide",
    description:
      "Walk the user through linking this IDE install to their ZeroMind account via the device-code flow. Use when auth_status says unlinked.",
  },
  {
    name: "open-and-iterate",
    description:
      "End-to-end loop: connect to a world (asking the user to open it in their browser if needed), iterate via execute/capture/vfs, then commit + push.",
    arguments: [
      {
        name: "world_name_or_guid",
        description: "Name or GUID of the world to open. If omitted, list and ask the user to pick.",
        required: false,
      },
    ],
  },
  {
    name: "file-engine-bug",
    description:
      "File a bug issue against OrigoZero/zero with the correct labels. Capture repro steps + screenshots before invoking.",
    arguments: [
      { name: "subsystem", description: "renderer | scripting | vfs | scene | physics | … (one)", required: true },
      { name: "summary", description: "One-line bug summary", required: true },
    ],
  },
];

export const getPrompt = (name: string, args: Record<string, string>): GetPromptResult => {
  switch (name) {
    case "getting-started":
      return {
        description: "Zero engine orientation",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                "## What is Zero?\n\n" +
                "Zero is a custom 3D engine with Luau scripting, compiled to native + WASM. It runs in the user's web browser when they open one of their worlds at https://origozero.ai/edit/<guid>." +
                "All work is organized into **worlds**: persistent multiplayer containers backed by spacetime + ZeroMind. Worlds survive restarts, sync across collaborators, and are the only path through which work reaches players.\n\n" +
                "## The plugin's tools\n\n" +
                "**Account/identity:**\n" +
                "- `auth_status` — see whether this IDE is linked to a user.\n" +
                "- `zm_link` / `zm_link_poll` — one-time device-code link (only needed once per IDE install).\n" +
                "- `zm_unlink` — revoke this IDE's link.\n\n" +
                "**Hivemind (the shared content library — CHECK THIS FIRST):**\n" +
                "- `hivemind.search` — find published worlds/assets others already made. The FIRST step of any build request: search before writing from scratch, to find (A) a drop-in solution, (B) reusable parts, or (C) a base to modify.\n" +
                "- `hivemind.inspect` — drill into a world/asset before reusing it (closure, dependents, comments).\n" +
                "- `hivemind.pull` — fetch the content closure of assets (the drop-in / parts / base).\n" +
                "- `hivemind.engage` — give back: vote, comment, review, bookmark, follow, report, record adoption.\n\n" +
                "**Worlds:**\n" +
                "- `world.list` — the user's worlds.\n" +
                "- `world.create({name, template?, public?})` — make a new world.\n" +
                "- `world.open_in_browser({guid})` — returns a URL the user has to click to actually open the world's runtime.\n" +
                "- `world.connect({guid})` — attach to the user's currently-open browser tab for that world. Subsequent engine tools default to this session.\n" +
                "- `world.disconnect` — detach.\n\n" +
                "**Engine (routed via WSS bridge to the WASM engine in the user's browser):**\n" +
                "- `execute({code})` — Luau snippet.\n" +
                "- `guides({path?, query?, list?})` — engine docs. Always `guides()` (no args) FIRST after every `world.connect` to load the README.\n" +
                "- `capture({})` — screenshot, returns base64 PNG.\n" +
                "- `read_file({path})` / `write_file({path, content})` / `edit_file({path, old_string, new_string})` — engine VFS (`/zero/...`).\n" +
                "- `bash({command})` — engine's scene-VFS bash.\n" +
                "- `luau_test({filter?})` — run the engine test suite.\n" +
                "- `instance_health({})` — health snapshot.\n\n" +
                "## The workflow\n\n" +
                "1. `auth_status`. If unlinked, run `zm_link`, surface the user_code + URL to the user, poll with `zm_link_poll` until approved.\n" +
                "2. **`hivemind.search`** — check the hivemind for what the user wants BEFORE building. Pull a drop-in / parts / base when there's a hit; only build from scratch when nothing usable exists.\n" +
                "3. `world.list` to find the world, or `world.create` if making a new one.\n" +
                "4. `world.connect({guid})`. If it returns `no_active_session`, surface the URL to the user, wait for them to open it, then retry.\n" +
                "5. `guides()` (no args) — read the engine README FIRST. Then use specific APIs.\n" +
                "6. Iterate with `execute` / `read_file` / `write_file` / `edit_file` / `capture`. Take screenshots after meaningful changes.\n" +
                "7. When the user wants to publish, `execute({code: \"zm.add('.'); zm.commit('msg'); zm.push()\"})`, then `hivemind.engage` to record pulls + vote/comment on content you used.\n\n" +
                "## Rules\n\n" +
                "- **Check the hivemind first.** Don't reimplement what's already published — search, then reuse. See the `zeromind-hivemind` skill.\n" +
                "- Never guess Luau API names — use `guides()` and `execute({code: \"return type(_G.name)\"})` to discover.\n" +
                "- Always verify visually (screenshot) AND with data, not just by reading code.\n" +
                "- File bugs to OrigoZero/zero with the file-engine-bug prompt.\n",
            },
          },
        ],
      };

    case "find-before-build": {
      const request = args.request ?? "<what the user asked you to build>";
      return {
        description: "Search the hivemind before building from scratch",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Before building "${request}" from scratch, check whether it already exists in the ZeroMind hivemind.\n\n` +
                "1. `auth_status` — if unlinked, link first (link-this-ide prompt).\n" +
                `2. \`hivemind.search { "q": "${request}" }\` — try the asset lens first. Add \`kind\` (module/component/shader/scene/…) to narrow. Try 2–3 phrasings; the index is semantic.\n` +
                "   - Also worth a look: `scope: \"worlds\"` (a whole project like this), `scope: \"top_by_kind\"` (best of a kind).\n" +
                "3. Read each hit's `compat_tier`, `agent_score`, `pulled_into_count`, and `import_hint`. Prefer `compatible` + high adoption.\n" +
                "4. Vet the best candidate: `hivemind.inspect { target: \"asset\", guid: \"…\", view: \"dependents\" }` (who already uses it) and `view: \"comments\"` (gotchas).\n" +
                "5. Decide the outcome:\n" +
                "   - **A — drop-in:** `hivemind.pull { asset_guids: [\"…\"] }`, then wire it in via its `import_hint`.\n" +
                "   - **B — parts:** pull several assets and write only the glue.\n" +
                "   - **C — base:** `hivemind.pull { asset_guids: [\"…\"], ensure_compat: false }`, `write_file` the closure into `/zero/source/`, then adapt it.\n" +
                "   - **Nothing usable:** build from scratch — and publish the result so the next agent gets outcome A.\n" +
                "6. After adopting: `hivemind.engage { action: \"record_pull\", world_guid: \"…\", asset_guid: \"…\" }`, then vote/comment on what you used.\n\n" +
                "See the `zeromind-hivemind` skill for the full reference.\n",
            },
          },
        ],
      };
    }

    case "link-this-ide":
      return {
        description: "Device-code link walkthrough",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                "Walk the user through linking this IDE to their ZeroMind account:\n\n" +
                "1. Call `zm_link`. It returns either `{status: 'approved', user_id}` (we're already linked, you're done), or `{status: 'pending', user_code, verification_url, expires_in, interval}`.\n" +
                "2. If pending: tell the user to open **https://origozero.ai/link** in their browser, sign in if needed, and enter the `user_code`. Mention it expires in `expires_in` seconds. **Always use `https://origozero.ai/link` as the URL — do NOT relay the `verification_url` field verbatim.** The backend currently returns an `api.origozero.ai/link` variant there, but the public approval page lives on the bare `origozero.ai` domain.\n" +
                "3. Poll `zm_link_poll` every `interval` seconds (default 5). When it returns `{status: 'approved', user_id}`, confirm to the user and proceed.\n" +
                "4. If `zm_link_poll` keeps returning pending past expiry, tell the user the code expired and call `zm_link` again for a fresh one.\n",
            },
          },
        ],
      };

    case "open-and-iterate": {
      const target = args.world_name_or_guid ?? "<ask the user which world>";
      return {
        description: "End-to-end edit loop against a browser world",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `End-to-end iteration loop for world: ${target}\n\n` +
                "1. `auth_status` — if unlinked, follow the link-this-ide prompt first.\n" +
                "2. `world.list` — find the world by name or guid.\n" +
                "3. `world.connect({guid})`. If `no_active_session`, give the user the URL (from the tool result) and wait for them to confirm they opened it. Retry `world.connect`.\n" +
                "4. `guides()` (no args) — read the engine README.\n" +
                "5. Use `execute` / `read_file` / `write_file` / `edit_file` to make the changes.\n" +
                "6. `capture()` after meaningful changes; show the user the screenshot.\n" +
                "7. When the user approves, run `execute({code: \"zm.commit('your message'); zm.push()\"})` to publish.\n\n" +
                "Never assume Luau API names — discover via guides() + introspection.\n",
            },
          },
        ],
      };
    }

    case "file-engine-bug": {
      const subsystem = args.subsystem ?? "<subsystem>";
      const summary = args.summary ?? "<one-line summary>";
      return {
        description: "File a bug against OrigoZero/zero",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `File a bug issue at https://github.com/OrigoZero/zero/issues/new with:\n\n` +
                `**Title:** \`bug: ${summary}\`\n\n` +
                `**Labels:** \`bug\`, \`${subsystem}\`, \`ai-found\` (always, since you found it).\n\n` +
                `**Body must contain (no fix suggestions):**\n\n` +
                `1. **What happened** — observed behavior, verbatim outputs / errors.\n` +
                `2. **What was expected** — the documented or implied correct behavior.\n` +
                `3. **How they differ** — one-sentence diff between expected and observed.\n` +
                `4. **Reproduction steps** — exact sequence: which world, which entrypoint, which tool calls, expected vs actual at each step.\n\n` +
                `Do NOT include proposed fixes, root cause guesses, or file:line pointers to where you think the fix belongs. Reproduction + recognition only.\n\n` +
                `If you have screenshots from \`capture()\` that show the bug, attach them via the GitHub web UI (paste into the issue body).\n`,
            },
          },
        ],
      };
    }

    default:
      throw new Error(`unknown prompt: ${name}`);
  }
};
