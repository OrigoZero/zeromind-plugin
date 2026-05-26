import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";

describe("mock ZeroMind REST", () => {
  let server: MockServerHandle;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });

  it("POST /v1/installs/register returns install_id + install_secret", async () => {
    const res = await fetch(`${server.url}/v1/installs/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ install_name: "test", public_key: "fakepk" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { install_id: string; install_secret: string };
    expect(body.install_id).toMatch(/^inst_/);
    expect(body.install_secret).toMatch(/^ins_sec_/);
  });

  it("rejects /v1/me/worlds without auth", async () => {
    const res = await fetch(`${server.url}/v1/me/worlds`);
    expect(res.status).toBe(401);
  });

  it("returns worlds list for an approved install", async () => {
    const reg = (await (
      await fetch(`${server.url}/v1/installs/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install_name: "test2", public_key: "fakepk" }),
      })
    ).json()) as { install_id: string; install_secret: string };

    server.forceApprove(reg.install_id, "usr_test");

    const res = await fetch(`${server.url}/v1/me/worlds`, {
      headers: { authorization: `Bearer ${reg.install_secret}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { worlds: unknown[] };
    expect(Array.isArray(body.worlds)).toBe(true);
  });
});
