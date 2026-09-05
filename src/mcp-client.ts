// The smallest MCP client that can call a tool on ZeroMind's `/mcp`.
//
// `initialize`, then `tools/call`, over streamable HTTP: one POST per
// message, the session id echoed from the initialize response on every
// later request. It exists so the CLI can reach a world's engine with the
// same credential and the same server every harness uses.

import { Agent, fetch, type Response } from "undici";
import { VERSION } from "./zeromind-client.js";

/** The protocol revision this client speaks. */
export const PROTOCOL_VERSION = "2025-06-18";

/** What a tool answered: its text content, and whether it refused. */
export type ToolOutcome = { text: string; isError: boolean };

type JsonRpcMessage = {
  id?: number | string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

/** Read one JSON-RPC message from a response that is either JSON or SSE. */
const readMessage = async (res: Response, id: number): Promise<JsonRpcMessage> => {
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(raw) as JsonRpcMessage;
  }
  const messages: JsonRpcMessage[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload) messages.push(JSON.parse(payload) as JsonRpcMessage);
  }
  const mine = messages.find((m) => m.id === id);
  if (mine) return mine;
  const answered = messages.find((m) => m.result !== undefined || m.error !== undefined);
  if (answered) return answered;
  throw new Error("the event stream carried no answer to the request");
};

export class McpHttpClient {
  private sessionId?: string;
  private nextId = 1;
  // Its own connection pool, so `close()` can end every socket it opened:
  // a keep-alive connection left on the shared dispatcher outlives the work
  // and holds the CLI's event loop open after the last call.
  private readonly agent = new Agent();

  constructor(
    private readonly url: string,
    private readonly bearer: string,
    private readonly harness = "zeromind-cli",
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.bearer}`,
      "X-ZM-Harness": this.harness,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async post(body: unknown): Promise<Response> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      dispatcher: this.agent,
    });
    if (res.status === 401) {
      throw new Error(
        `${this.url} rejected this machine's credential (401); run \`zeromind link\` and try again`,
      );
    }
    if (!res.ok) throw new Error(`${this.url} answered ${res.status}: ${await res.text()}`);
    return res;
  }

  /** Open the session: `initialize`, keep the session id, say we're ready. */
  async initialize(): Promise<void> {
    const id = this.nextId++;
    const res = await this.post({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "zeromind-cli", version: VERSION },
      },
    });
    const sessionId = res.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    const message = await readMessage(res, id);
    if (message.error) throw new Error(`initialize: ${message.error.message}`);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** End every connection this client opened. */
  async close(): Promise<void> {
    await this.agent.close();
  }

  /** Call one tool. A refusal comes back as `isError` with the server's text. */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const id = this.nextId++;
    const res = await this.post({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const message = await readMessage(res, id);
    if (message.error) return { text: message.error.message, isError: true };
    const text = (message.result?.content ?? [])
      .map((part) => part.text)
      .filter((part): part is string => typeof part === "string")
      .join("\n");
    return { text, isError: message.result?.isError === true };
  }
}
