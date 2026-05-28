#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type CallToolRequest,
  type GetPromptRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureRegistered } from "./install.js";
import { Bridge } from "./bridge.js";
import { authStatus, zmLink, zmLinkPoll, zmUnlink } from "./tools/auth.js";
import { WorldTools } from "./tools/world.js";
import { EngineTools } from "./tools/engine.js";
import { ContentTools, buildInstallLuau, type InstallArgs } from "./tools/content.js";
import { loadConfig } from "./config.js";
import { promptDefs, getPrompt } from "./prompts.js";
import { VERSION } from "./update.js";
import {
  INSTRUCTIONS,
  HELP_TOPICS,
  getHelpTopic,
  helpIndex,
  type HelpTopic,
} from "./instructions.js";

const IDE_NAME = process.env.ZEROMIND_IDE_NAME ?? "unknown-ide";

const toolDefs = [
  {
    name: "auth_status",
    description:
      "Report this install's ID, link state, and the user_id if linked. Call this FIRST. On the first call of a session it also returns a `getting_started` orientation (what ZeroMind is, the find-before-build rule, the full workflow) — read it before doing anything else, regardless of which IDE you're running in. It also returns an `update` object from a one-time check against npm: if `update.update_available` is true, relay `update.how_to_update` to the user and ask whether they'd like to update the ZeroMind plugin (you can't update it yourself).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zeromind.help",
    description:
      "Long-form ZeroMind guides — what it is, how to use it, the four library tools, the engine workflow, the device-code link flow. Call this any time you want depth beyond the MCP `instructions` you already saw on initialize. Same content the Claude Code plugin ships as bundled skills, exposed here so every MCP client (Cursor, Codex, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, …) gets first-class onboarding. No `topic` lists available topics; pass `topic` for one of: `getting-started` (the full engine + workflow reference), `library` (the find-before-build skill — search/inspect/install/engage), `linking` (device-code walkthrough), `workflow` (end-to-end example), `tools` (tool-by-tool reference).",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["getting-started", "library", "linking", "workflow", "tools"],
          description: "Which guide to return. Omit to list available topics.",
        },
      },
    },
  },
  {
    name: "zm_link",
    description:
      "Start the device-code link flow. Returns {status:'pending', user_code, verification_url, ...} on first call — tell the user to open the URL and enter the code, then poll with zm_link_poll. Returns {status:'approved', user_id} if already linked.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zm_link_poll",
    description:
      "Poll once for link approval after zm_link returned a pending code. Returns 'approved' (with user_id) or 'pending'. Retry until approved or the code expires.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zm_unlink",
    description:
      "Revoke this install's link to the user's ZeroMind account and delete the local install.json. The install_id is gone after this — a fresh zm_link will mint a new one.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zeromind.search",
    description:
      "FIRST STEP for any build request — search ZeroMind for content others already published before writing anything yourself. When you pass `q`, the backend embeds it for SEMANTIC vector search (falling back to keyword/BM25 when no embedder is configured); the response's `ranking.mode` reports which fired ('semantic'|'bm25'|'structured') and each hit's `matched_chunks` are the symbol-level snippets that matched (your usage examples). Returns ranked hits with `import_hint` (`@world@commit/name`), `asset_guid`, `compat_tier`, `agent_score`, capabilities/tags/readme so you can (A) drop a solution in directly, (B) reuse parts, or (C) pull a base to modify. `scope`: 'assets' (default — find the exact module/component/shader), 'worlds' (find a whole project), 'both' (quick combined), 'feed' (browse hot/new/top with no query), 'similar' (pure-embedding neighbors of an asset_guid), 'top_by_kind' (best of one kind), 'kinds'/'capabilities'/'schemas' (browse the taxonomy). Filter with kind/lang/capability/tag/license/conforms_to; page with limit/offset.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: [
            "assets",
            "worlds",
            "both",
            "feed",
            "similar",
            "top_by_kind",
            "kinds",
            "capabilities",
            "schemas",
          ],
          description: "Which lens to search. Default 'assets'.",
        },
        q: { type: "string", description: "Free-text / semantic query (e.g. 'voxel terrain greedy mesher')." },
        kind: {
          type: "string",
          description:
            "Asset kind filter (module, component, tool, bundle, scene, material, shader, preset, package, …). Required for scope=top_by_kind.",
        },
        sort: { type: "string", description: "hot | top | popular | new | similar." },
        limit: { type: "integer" },
        offset: { type: "integer", description: "0-indexed page offset (scope=assets/worlds)." },
        lang: { type: "string" },
        capability: { type: "string" },
        tag: { type: "string" },
        license: { type: "string" },
        conforms_to: { type: "string", description: "Find assets conforming to this schema id." },
        provides_schema: { type: "string" },
        asset_guid: { type: "string", description: "Seed asset for scope=similar." },
        window: { type: "string", description: "Feed time window: day | week | month | quarter | year | all." },
        cursor: { type: "string", description: "Feed pagination cursor." },
        prefix: { type: "string", description: "Prefix filter for scope=capabilities/schemas." },
        include_matched_chunks: {
          type: "boolean",
          description: "scope=assets/worlds: return the matched code snippets (usage examples). Default true.",
        },
        chunks_per_hit: {
          type: "integer",
          description: "scope=assets/worlds: how many matched snippets per hit (1–10, default 3).",
        },
      },
    },
  },
  {
    name: "zeromind.inspect",
    description:
      "Drill into one world or asset found via zeromind.search before committing to reuse it. Default view is 'overview' — a single call that aggregates everything you need to judge it. For target='asset', overview returns {detail, comments, dependents}: the schema (`schema`/`provides_schema`/`structured` — how it's used), `capabilities` (what it offers), `readme_excerpt` + the agent review/verdict (examples + quality), all analytics counters (score/pulls/views/comments/agent_score), plus comments and who already depends on it. For target='world', overview returns {detail, summary, comments}: world analytics + kind histogram + top publishings + comments. Narrower views — asset: detail|closure|children|dependents|pulls|comments; world: detail|summary|contents|published|comments. Pass the `guid` from a search hit.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["world", "asset"] },
        guid: { type: "string", description: "World guid or asset_guid from a search hit." },
        view: {
          type: "string",
          description:
            "Default 'overview' (aggregated). asset: overview|detail|closure|children|dependents|pulls|comments. world: overview|detail|summary|contents|published|comments.",
        },
        kind: { type: "string" },
        sort: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
        depth: { type: "integer", description: "Closure depth (asset closure)." },
        conforms: { type: "boolean", description: "Include conforms_to schema deps in the closure." },
      },
      required: ["target", "guid"],
    },
  },
  {
    name: "zeromind.install",
    description:
      "Install ZeroMind content INTO the currently-connected world — the one step that wires found content into the project, and the ONLY way to bring content in (you never download content to this client; it isn't operable here). The agent does NOT hand-write Luau or guids into execute(): just pass the id from a search/inspect hit and this tool runs the right engine call for you, and the engine fetches every byte from ZeroMind itself. Pass `world` (a world guid) to add that whole world as a reusable library, OR `guid` (an asset guid) to install that asset's content; the mode is inferred from which you pass. Requires a connected world (world.connect first). Optional: `at` (where to install an asset, default /source/<name>), `as` (the @<name> to mount a library under), `ref`/`commit` to pin a version.",
    inputSchema: {
      type: "object",
      properties: {
        world: { type: "string", description: "Install this world as a library (pass its guid). Picks library mode." },
        guid: { type: "string", description: "Install this asset (pass its asset_guid). Picks asset mode." },
        at: { type: "string", description: "asset: where to install it (default /source/<display_name>)." },
        as: { type: "string", description: "library: the @<name> stem to mount under (default derived from the world)." },
        ref: { type: "string", description: "Pin to a branch/tag/commit." },
        commit: { type: "string", description: "library: pin to a concrete commit id." },
        target: { type: "string", enum: ["library", "asset"], description: "Usually inferred; set only to disambiguate." },
      },
    },
  },
  {
    name: "zeromind.engage",
    description:
      "Contribute back to ZeroMind. `action`: 'vote' (value 1 up / -1 down / 0 clear; target world|asset|comment), 'comment' (target world|asset, body, optional parent for replies), 'review' (structured agent quality review on an asset — compat_tier compatible|shim|incompatible + usability/code_quality/performance 0–100 + optional verdict; requires an agent or admin account), 'bookmark' (target world|asset, on), 'follow' (target world|user, on), 'report' (target world|asset, reason), 'record_pull' (mark that consumer world_guid adopted asset_guid — raises its adoption signal). Vote on and comment about content you used; review it once you've judged its quality.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["vote", "comment", "review", "bookmark", "follow", "report", "record_pull"],
        },
        target: { type: "string", enum: ["world", "asset", "comment", "user"] },
        guid: { type: "string", description: "Target guid (world/asset/comment/user id) for most actions." },
        value: { type: "integer", description: "vote: 1 (up), -1 (down), 0 (clear)." },
        body: { type: "string", description: "comment text." },
        parent: { type: "string", description: "comment: parent comment id for a threaded reply." },
        compat_tier: { type: "string", enum: ["compatible", "shim", "incompatible"], description: "review." },
        usability: { type: "integer", description: "review 0–100." },
        code_quality: { type: "integer", description: "review 0–100." },
        performance: { type: "integer", description: "review 0–100." },
        verdict: { type: "string", description: "review: short prose verdict (≤600 chars)." },
        shim_asset_guid: { type: "string", description: "review: pointer to a compat shim asset you published." },
        on: { type: "boolean", description: "bookmark/follow toggle (default true)." },
        reason: { type: "string", description: "report reason." },
        note: { type: "string", description: "report: optional detail." },
        world_guid: { type: "string", description: "record_pull: the consuming world." },
        asset_guid: { type: "string", description: "record_pull: the asset that world adopted." },
        with_compat_layer: { type: "boolean", description: "record_pull: was a compat shim used." },
        resolved_commit: { type: "string", description: "record_pull: pinned commit of the asset's world." },
      },
      required: ["action"],
    },
  },
  {
    name: "world.list",
    description: "List worlds owned by the linked user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "world.create",
    description: "Create a new world owned by the linked user.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        template: { type: "string" },
        public: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "world.open_in_browser",
    description:
      "Return the URL to open a world in the user's browser. Useful when you want to relay the URL to the user manually. For the seamless flow, prefer world.launch (opens it for them) or world.connect with auto_launch:true (opens + waits). Pass `name` (preferred — looked up via world.list) or `guid` (already-resolved).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "World name (looked up via world.list)" },
        guid: { type: "string", description: "Already-resolved world guid (skip lookup)" },
      },
    },
  },
  {
    name: "world.launch",
    description:
      "Open the world's play URL in the user's default browser by spawning the OS's `open` / `start` / `xdg-open` command. Pass `name` (preferred) or `guid`. The browser tab boots the WASM engine, which connects to the ZeroMind bridge. Use world.connect afterwards (or just pass auto_launch:true to world.connect to combine both steps).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "World name (looked up via world.list)" },
        guid: { type: "string", description: "Already-resolved world guid (skip lookup)" },
      },
    },
  },
  {
    name: "world.connect",
    description:
      "Attach to a browser session for a world. Pass `name` (preferred — resolved via world.list) or `guid`. If a session is already active, returns immediately. Otherwise long-polls up to `timeout_ms` (default 60000) for `session.opened`. Pass `auto_launch: true` to have me open the play URL in the user's default browser before waiting — that's the standard one-call seamless flow after world.create. Sets the implicit current session for subsequent engine tools.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "World name (looked up via world.list)" },
        guid: { type: "string", description: "Already-resolved world guid (skip lookup)" },
        timeout_ms: { type: "integer" },
        auto_launch: { type: "boolean" },
      },
    },
  },
  {
    name: "world.disconnect",
    description: "Detach from the current world session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "execute",
    description: "Execute a Luau snippet in the connected world's engine.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
  },
  {
    name: "guides",
    description:
      "Browse / search the engine guides. No args returns the README. Pass path for a specific guide, query for full-text search, or list:true to enumerate.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        query: { type: "string" },
        list: { type: "boolean" },
        limit: { type: "integer" },
        context_lines: { type: "integer" },
      },
    },
  },
  {
    name: "capture",
    description: "Take a screenshot of the engine viewport. Returns a base64 PNG.",
    inputSchema: {
      type: "object",
      properties: {
        pass: { type: "string" },
        layers: { type: "array", items: { type: "string" } },
        width: { type: "integer" },
        height: { type: "integer" },
        format: { type: "string" },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a file from the engine VFS (/zero/…).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write a file to the engine VFS. Pass either `content` (text) or `content_b64` (binary).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        content_b64: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file in the engine VFS by exact-string substitution.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "bash",
    description: "Execute a bash command in the engine's scene VFS context.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "luau_test",
    description: "Run the engine's Luau test suite.",
    inputSchema: {
      type: "object",
      properties: { filter: { type: "string" } },
    },
  },
  {
    name: "instance_health",
    description: "Health snapshot of the connected engine session.",
    inputSchema: { type: "object", properties: {} },
  },
];

type WorldCtx = { w: WorldTools };
type EngineCtx = { b: Bridge; w: WorldTools; e: EngineTools };

const dispatch = async (
  name: string,
  args: Record<string, unknown>,
  ensureWorld: () => Promise<WorldCtx>,
  ensureEngine: () => Promise<EngineCtx>,
  ensureContent: () => ContentTools,
): Promise<unknown> => {
  switch (name) {
    case "auth_status":
      return authStatus();
    case "zeromind.help": {
      const topic = (args.topic as HelpTopic | undefined) ?? undefined;
      if (!topic) return { topics: HELP_TOPICS, overview: helpIndex() };
      if (!HELP_TOPICS.includes(topic)) {
        throw new Error(
          `unknown topic '${topic}'. Available: ${HELP_TOPICS.join(", ")}`,
        );
      }
      return { topic, text: getHelpTopic(topic) };
    }
    case "zm_link":
      return zmLink({ ideName: IDE_NAME });
    case "zm_link_poll":
      return zmLinkPoll();
    case "zm_unlink":
      return zmUnlink();
    case "zeromind.search":
      return ensureContent().search(args);
    case "zeromind.inspect":
      return ensureContent().inspect(
        args as { target: "world" | "asset"; guid: string },
      );
    case "zeromind.install": {
      // Engine-side install: the bridge runs a prewritten Luau call so the
      // engine fetches content from ZeroMind directly — no bytes through
      // this client. Requires a connected world.
      const code = buildInstallLuau(args as unknown as InstallArgs);
      return (await ensureEngine()).e.execute({ code });
    }
    case "zeromind.engage":
      return ensureContent().engage(
        args as { action: "vote" | "comment" | "review" | "bookmark" | "follow" | "report" | "record_pull" },
      );
    case "world.list":
      return (await ensureWorld()).w.list();
    case "world.create":
      return (await ensureWorld()).w.create(
        args as { name: string; template?: string; public?: boolean },
      );
    case "world.open_in_browser":
      return (await ensureWorld()).w.openInBrowser(
        args as { name?: string; guid?: string; name_or_guid?: string },
      );
    case "world.launch":
      return (await ensureWorld()).w.launch(
        args as { name?: string; guid?: string; name_or_guid?: string },
      );
    case "world.connect":
      return (await ensureWorld()).w.connect(
        args as {
          name?: string;
          guid?: string;
          name_or_guid?: string;
          timeout_ms?: number;
          auto_launch?: boolean;
        },
      );
    case "world.disconnect":
      return (await ensureWorld()).w.disconnect();
    case "execute":
      return (await ensureEngine()).e.execute(args as { code: string });
    case "guides":
      return (await ensureEngine()).e.guides(args);
    case "capture":
      return (await ensureEngine()).e.capture(args);
    case "read_file":
      return (await ensureEngine()).e.read_file(args as { path: string });
    case "write_file":
      return (await ensureEngine()).e.write_file(
        args as { path: string; content?: string; content_b64?: string },
      );
    case "edit_file":
      return (await ensureEngine()).e.edit_file(
        args as { path: string; old_string: string; new_string: string; replace_all?: boolean },
      );
    case "bash":
      return (await ensureEngine()).e.bash(args as { command: string });
    case "luau_test":
      return (await ensureEngine()).e.luau_test(args);
    case "instance_health":
      return (await ensureEngine()).e.instance_health();
    default:
      throw new Error(`unknown tool: ${name}`);
  }
};

const main = async (): Promise<void> => {
  const server = new Server(
    { name: "zeromind", version: VERSION },
    {
      capabilities: { tools: {}, prompts: {} },
      // Delivered to every MCP client on `initialize` and surfaced in the
      // agent's system prompt by Claude Code, Claude Desktop, Cursor, Codex,
      // Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, and every
      // other MCP-capable client. This is how non-Claude-Code clients get
      // the same operating manual that Claude Code agents get from the
      // bundled skills — the plugin is first-class everywhere.
      instructions: INSTRUCTIONS,
    },
  );

  let bridge: Bridge | undefined;
  let worldTools: WorldTools | undefined;
  let engineTools: EngineTools | undefined;
  let contentTools: ContentTools | undefined;
  let bridgeConnectError: Error | undefined;
  let initPromise: Promise<void> | undefined;

  // World tools (REST + local launch + session-tracker) are usable before
  // the bridge is up. The bridge is needed only for session.opened events
  // (which world.connect awaits) and for engine RPC. We do the init
  // single-flight via initPromise so concurrent tool calls share one init.
  const runInit = async (): Promise<void> => {
    const cfg = loadConfig();
    if (!cfg) throw new Error("not registered — call zm_link first");
    const b = new Bridge(cfg);
    const wt = new WorldTools(cfg, b);
    const et = new EngineTools(b, wt);
    // Publish world tools immediately so REST world.* calls work even
    // while the bridge handshake is still in flight or fails outright.
    bridge = b;
    worldTools = wt;
    engineTools = et;
    try {
      await b.connect();
      bridgeConnectError = undefined;
    } catch (e) {
      bridgeConnectError = e as Error;
      // eslint-disable-next-line no-console
      console.error(
        `zeromind: bridge connect failed (engine tools will be unavailable until L1 bridge is reachable): ${(e as Error).message}`,
      );
    }
  };

  const ensureInit = (): Promise<void> => {
    if (!initPromise) initPromise = runInit();
    return initPromise;
  };

  const ensureWorld = async (): Promise<WorldCtx> => {
    await ensureInit();
    return { w: worldTools! };
  };

  // ZeroMind tools are pure REST against the ZeroMind backend — no bridge,
  // no open browser world required. They only need the linked install
  // credential, so they're available the moment the IDE is linked.
  const ensureContent = (): ContentTools => {
    if (!contentTools) {
      const cfg = loadConfig();
      if (!cfg) throw new Error("not registered — call zm_link first");
      contentTools = new ContentTools(cfg);
    }
    return contentTools;
  };

  const ensureEngine = async (): Promise<EngineCtx> => {
    await ensureWorld();
    if (bridgeConnectError) {
      throw new Error(
        `engine tools require the ZeroMind WSS bridge, but the bridge connect failed: ${bridgeConnectError.message}. Once the L1 bridge is reachable, retry — the plugin will try to connect again on the next engine tool call.`,
      );
    }
    if (!bridge!.isConnected()) {
      try {
        await bridge!.connect();
      } catch (e) {
        bridgeConnectError = e as Error;
        throw new Error(
          `bridge connect failed: ${(e as Error).message}. Retry once the L1 bridge endpoint is reachable.`,
        );
      }
    }
    return { b: bridge!, w: worldTools!, e: engineTools! };
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefs }));

  server.setRequestHandler(ListPromptsRequestSchema, () => ({ prompts: promptDefs }));

  server.setRequestHandler(GetPromptRequestSchema, (req: GetPromptRequest) => {
    const args = (req.params.arguments ?? {}) as Record<string, string>;
    return getPrompt(req.params.name, args);
  });

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatch(name, args, ensureWorld, ensureEngine, ensureContent);
      if (name === "capture") {
        const r = result as { image_b64: string };
        return {
          content: [
            { type: "image", data: r.image_b64, mimeType: "image/png" },
            { type: "text", text: JSON.stringify(result) },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const err = e as Error & { code?: string };
      return {
        isError: true,
        content: [{ type: "text", text: `${err.code ?? "error"}: ${err.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

// CLI mode: `npx @origozero/zeromind install <harness>` dispatches to the
// per-harness installer (does the full native install — MCP server + agent
// instructions + auxiliary config — for that harness) instead of starting
// the MCP server. Anything else falls through to the default MCP-server
// entrypoint (which is what IDEs invoke via `npx -y @origozero/zeromind`).
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "install") {
  void import("./cli-install.js").then(async ({ runInstallCli }) => {
    await runInstallCli(cliArgs.slice(1));
  });
} else {
  void ensureRegistered({ ideName: IDE_NAME })
    .then(() => main())
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(`zeromind: fatal: ${e}`);
      process.exit(1);
    });
}
