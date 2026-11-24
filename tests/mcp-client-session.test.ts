import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpHttpClient } from "../src/mcp-client.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const serve = async (
  handle: (method: string, session: string | undefined) => { status: number; body: unknown },
): Promise<{ url: string; seen: string[] }> => {
  const seen: string[] = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const message = JSON.parse(raw) as { method: string; id?: number };
      seen.push(message.method);
      const session = req.headers["mcp-session-id"] as string | undefined;
      const answer = handle(message.method, session);
      res.writeHead(answer.status, {
        "content-type": "application/json",
        ...(message.method === "initialize" ? { "mcp-session-id": "session-1" } : {}),
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...(answer.body as object) }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`, seen };
};
const ok = { status: 200, body: { result: { content: [{ type: "text", text: "1" }] } } };

it("calls a tool with no initialize when the server takes the conversation from _meta", async () => {
  const { url, seen } = await serve(() => ok);
  const client = new McpHttpClient(url, "token", "zero-cli", "zero-cli:abc");
  expect((await client.callTool("execute", { code: "return 1" })).text).toBe("1");
  await client.close();
  expect(seen).toEqual(["tools/call"]);
});

it("opens a transport session once when the server asks for one, then repeats the request", async () => {
  const { url, seen } = await serve((method, session) =>
    method === "tools/call" && !session
      ? { status: 404, body: { error: { code: -32001, message: "initialize first" } } }
      : ok,
  );
  const client = new McpHttpClient(url, "token", "zero-cli", "zero-cli:abc");
  expect((await client.callTool("execute", { code: "return 1" })).text).toBe("1");
  expect((await client.callTool("execute", { code: "return 2" })).text).toBe("1");
  await client.close();
  expect(seen).toEqual([
    "tools/call",
    "initialize",
    "notifications/initialized",
    "tools/call",
    "tools/call",
  ]);
});

it("does not repeat a refusal that is not about the session", async () => {
  const { url, seen } = await serve(() => ({ status: 500, body: {} }));
  const client = new McpHttpClient(url, "token", "zero-cli", "zero-cli:abc");
  await expect(client.callTool("execute", { code: "return 1" })).rejects.toThrow("500");
  await client.close();
  expect(seen).toEqual(["tools/call"]);
});
