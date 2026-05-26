import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";

describe("mock bridge WSS", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("rejects ide role without valid install_secret", async () => {
    const ws = new WebSocket(`${server.wsUrl}/v1/bridge?role=ide`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {
        // suppress; we expect a close with 4401
      });
    });
    expect(code).toBe(4401);
  });

  it("routes rpc.call from ide to a browser session and back", async () => {
    const reg = (await (
      await fetch(`${server.url}/v1/installs/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install_name: "t", public_key: "pk" }),
      })
    ).json()) as { install_id: string; install_secret: string };
    server.forceApprove(reg.install_id, "usr_x");

    const worldGuid = "wld_test";
    const sessionId = "ses_abc";
    const browser = new WebSocket(
      `${server.wsUrl}/v1/bridge?role=browser&world_guid=${worldGuid}&session_id=${sessionId}`,
      { headers: { authorization: "Bearer mock-user-jwt-usr_x" } },
    );
    await new Promise<void>((r) => browser.once("open", () => r()));

    const ide = new WebSocket(`${server.wsUrl}/v1/bridge?role=ide`, {
      headers: { authorization: `Bearer ${reg.install_secret}` },
    });
    await new Promise<void>((r) => ide.once("open", () => r()));

    browser.on("message", (raw) => {
      const f = JSON.parse(raw.toString()) as { type?: string; id?: string };
      if (f.type === "rpc.call") {
        browser.send(
          JSON.stringify({ type: "rpc.response", id: f.id, result: { echoed: true } }),
        );
      }
    });

    const idePromise = new Promise<unknown>((resolve) => {
      ide.on("message", (raw) => {
        const f = JSON.parse(raw.toString()) as {
          type?: string;
          id?: string;
          result?: unknown;
        };
        if (f.type === "rpc.response" && f.id === "1") resolve(f.result);
      });
    });
    ide.send(
      JSON.stringify({
        type: "rpc.call",
        id: "1",
        target_session: sessionId,
        method: "execute",
        params: { code: "x" },
      }),
    );

    const result = await idePromise;
    expect(result).toEqual({ echoed: true });

    ide.close();
    browser.close();
  });
});
