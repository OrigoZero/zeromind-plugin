#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureRegistered } from "./install.js";
import { Bridge } from "./bridge.js";
import { authStatus, zmLink, zmLinkPoll, zmUnlink } from "./tools/auth.js";
import { WorldTools } from "./tools/world.js";
import { EngineTools } from "./tools/engine.js";
import { loadConfig } from "./config.js";

const IDE_NAME = process.env.ZEROMIND_IDE_NAME ?? "unknown-ide";

const toolDefs = [
  {
    name: "auth_status",
    description:
      "Report this install's ID, link state, and the user_id if linked. Use first if you want to know whether the user has linked this IDE yet.",
    inputSchema: { type: "object", properties: {} },
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
      "Return the URL to open a world in the user's browser. The user must open this URL and then world.connect can attach.",
    inputSchema: {
      type: "object",
      properties: { guid: { type: "string" } },
      required: ["guid"],
    },
  },
  {
    name: "world.connect",
    description:
      "Attach to an active browser session for a world. If no session is active, returns the URL for the user to open. Sets the implicit current session for subsequent engine tools.",
    inputSchema: {
      type: "object",
      properties: { guid: { type: "string" } },
      required: ["guid"],
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

type ToolCtx = { b: Bridge; w: WorldTools; e: EngineTools };

const dispatch = async (
  name: string,
  args: Record<string, unknown>,
  ensureBridge: () => Promise<ToolCtx>,
): Promise<unknown> => {
  switch (name) {
    case "auth_status":
      return authStatus();
    case "zm_link":
      return zmLink({ ideName: IDE_NAME });
    case "zm_link_poll":
      return zmLinkPoll();
    case "zm_unlink":
      return zmUnlink();
    case "world.list":
      return (await ensureBridge()).w.list();
    case "world.create":
      return (await ensureBridge()).w.create(
        args as { name: string; template?: string; public?: boolean },
      );
    case "world.open_in_browser":
      return (await ensureBridge()).w.openInBrowser(args.guid as string);
    case "world.connect":
      return (await ensureBridge()).w.connect(args as { guid: string });
    case "world.disconnect":
      return (await ensureBridge()).w.disconnect();
    case "execute":
      return (await ensureBridge()).e.execute(args as { code: string });
    case "guides":
      return (await ensureBridge()).e.guides(args);
    case "capture":
      return (await ensureBridge()).e.capture(args);
    case "read_file":
      return (await ensureBridge()).e.read_file(args as { path: string });
    case "write_file":
      return (await ensureBridge()).e.write_file(
        args as { path: string; content?: string; content_b64?: string },
      );
    case "edit_file":
      return (await ensureBridge()).e.edit_file(
        args as { path: string; old_string: string; new_string: string; replace_all?: boolean },
      );
    case "bash":
      return (await ensureBridge()).e.bash(args as { command: string });
    case "luau_test":
      return (await ensureBridge()).e.luau_test(args);
    case "instance_health":
      return (await ensureBridge()).e.instance_health();
    default:
      throw new Error(`unknown tool: ${name}`);
  }
};

const main = async (): Promise<void> => {
  const server = new Server(
    { name: "zeromind", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  let bridge: Bridge | undefined;
  let worldTools: WorldTools | undefined;
  let engineTools: EngineTools | undefined;

  const ensureBridge = async (): Promise<ToolCtx> => {
    const cfg = loadConfig();
    if (!cfg) throw new Error("not registered — call zm_link first");
    if (!bridge) {
      bridge = new Bridge(cfg);
      await bridge.connect();
      worldTools = new WorldTools(cfg, bridge);
      engineTools = new EngineTools(bridge, worldTools);
    }
    return { b: bridge, w: worldTools!, e: engineTools! };
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefs }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatch(name, args, ensureBridge);
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

void ensureRegistered({ ideName: IDE_NAME })
  .then(() => main())
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`zeromind: fatal: ${e}`);
    process.exit(1);
  });
