import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyAgent } from "../src/cli-agent.js";

let server: Server | undefined;
afterEach(async () => {
  const closing = server;
  server = undefined;
  if (closing) {
    closing.closeAllConnections();
    await new Promise((resolve) => closing.close(resolve));
  }
});

/** A /v1/me stand-in answering the scripted statuses in order (`200` is a good agent, `"hang"` never answers). */
async function serve(
  script: Array<number | "hang">,
): Promise<{ url: string; requests: () => number }> {
  let seen = 0;
  server = createServer((req, res) => {
    const step = script[Math.min(seen++, script.length - 1)];
    if (step === "hang") return;
    res.writeHead(step, { "content-type": "application/json" });
    res.end(
      step === 200
        ? JSON.stringify({ user: { id: "agent-1", username: "cli-builder", is_agent: true } })
        : JSON.stringify({ error: "x" }),
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: () => seen,
  };
}

const noWait = async () => {};

it.each([401, 403])("reports %i as an authorization refusal after one request", async (status) => {
  const stub = await serve([status]);
  const waits: number[] = [];
  await expect(
    verifyAgent("secret", stub.url, { wait: async (ms) => void waits.push(ms) }),
  ).rejects.toThrow(`Agent authorization was refused (${status}); run zero login`);
  expect(stub.requests()).toBe(1);
  expect(waits).toEqual([]);
});

it.each([500, 503, 429])(
  "reports a persistent %i as a retryable service error, never as a refusal",
  async (status) => {
    const stub = await serve([status]);
    const waits: number[] = [];
    const failure = await verifyAgent("secret", stub.url, {
      wait: async (ms) => void waits.push(ms),
    }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(`HTTP ${status}`);
    expect(message).toContain("temporary service problem");
    expect(message).not.toContain("refused");
    expect(message).not.toContain("zero login");
    expect(stub.requests()).toBe(3);
    expect(waits).toEqual([500, 1000]);
  },
);

it("succeeds when a transient answer is followed by a good one", async () => {
  const stub = await serve([500, 503, 200]);
  const agent = await verifyAgent("secret", stub.url, { wait: noWait });
  expect(agent.id).toBe("agent-1");
  expect(stub.requests()).toBe(3);
});

it("reports a request that gets no answer in time as a retryable service error", async () => {
  const stub = await serve(["hang"]);
  const message = await verifyAgent("secret", stub.url, {
    attempts: 2,
    timeoutMs: 50,
    wait: noWait,
  }).catch((error: Error) => error.message);
  expect(message).toContain("no answer in time");
  expect(message).toContain("temporary service problem");
  expect(message).not.toContain("zero login");
  expect(stub.requests()).toBe(2);
});

it("reports an unreachable service as a retryable service error", async () => {
  const stub = await serve([200]);
  const url = stub.url;
  await new Promise((resolve) => server!.close(resolve));
  server = undefined;
  const message = await verifyAgent("secret", url, { attempts: 2, wait: noWait }).catch(
    (error: Error) => error.message,
  );
  expect(message).toContain("temporary service problem");
  expect(message).not.toContain("zero login");
});
