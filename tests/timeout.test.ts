import { describe, it, expect, afterEach } from "vitest";
import {
  withTimeout,
  toolTimeoutMs,
  ToolTimeoutError,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "../src/timeout.js";

const delay = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("withTimeout", () => {
  it("resolves with the op's value when it settles before the deadline", async () => {
    await expect(withTimeout(delay(5, "ok"), 1_000, "execute")).resolves.toBe("ok");
  });

  it("rejects with a ToolTimeoutError naming the tool when the deadline wins", async () => {
    const never = new Promise<never>(() => {});
    const err = await withTimeout(never, 20, "capture").catch((e) => e);
    expect(err).toBeInstanceOf(ToolTimeoutError);
    expect(err.code).toBe("timeout");
    expect(err.tool).toBe("capture");
    expect(err.timeout_ms).toBe(20);
    expect(err.message).toContain("capture");
    expect(err.message).toContain("ZEROMIND_TOOL_TIMEOUT_MS");
  });

  it("propagates the op's own rejection unchanged (not masked by the watchdog)", async () => {
    const boom = Promise.reject(new Error("engine blew up"));
    await expect(withTimeout(boom, 1_000, "bash")).rejects.toThrow("engine blew up");
  });
});

describe("toolTimeoutMs", () => {
  afterEach(() => {
    delete process.env.ZEROMIND_TOOL_TIMEOUT_MS;
  });

  it("defaults when unset", () => {
    expect(toolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });

  it("honours a positive numeric override", () => {
    process.env.ZEROMIND_TOOL_TIMEOUT_MS = "5000";
    expect(toolTimeoutMs()).toBe(5_000);
  });

  it("falls back to the default for non-positive or non-numeric values", () => {
    process.env.ZEROMIND_TOOL_TIMEOUT_MS = "0";
    expect(toolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
    process.env.ZEROMIND_TOOL_TIMEOUT_MS = "-1";
    expect(toolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
    process.env.ZEROMIND_TOOL_TIMEOUT_MS = "not-a-number";
    expect(toolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });
});
