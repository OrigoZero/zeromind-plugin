import { describe, it, expect } from "vitest";
import { toToolContent } from "../src/mcp-result.js";

describe("toToolContent", () => {
  it("wraps a canonical image block (camelCase mimeType) as image content", () => {
    // What a current engine sends over the bridge for `capture` / `read_file`.
    const r = toToolContent({ type: "image", data: "AAAA", mimeType: "image/png" });
    expect(r).toEqual({
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
  });

  it("wraps a legacy image block (snake_case mime_type) as image content", () => {
    // Older engines emitted snake_case; the plugin must still deliver an image.
    const r = toToolContent({ type: "image", mime_type: "image/png", data: "AAAA" });
    expect(r).toEqual({
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
  });

  it("defaults the mime type to image/png when absent", () => {
    const r = toToolContent({ type: "image", data: "AAAA" });
    expect(r).toEqual({
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
  });

  it("does NOT echo the base64 a second time as text (no payload doubling)", () => {
    const r = toToolContent({ type: "image", data: "AAAA", mimeType: "image/png" });
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe("image");
  });

  it("treats an image block missing data as a normal (text) result", () => {
    // Defensive: never emit an image content block without a string `data`
    // (that is the exact -32602 schema failure from zero#3840).
    const result = { type: "image", mimeType: "image/png" };
    const r = toToolContent(result);
    expect(r).toEqual({
      content: [{ type: "text", text: JSON.stringify(result) }],
    });
  });

  it("wraps a non-image object result as JSON text", () => {
    const r = toToolContent({ value: 99 });
    expect(r).toEqual({
      content: [{ type: "text", text: JSON.stringify({ value: 99 }) }],
    });
  });

  it("wraps a string result as JSON text", () => {
    const r = toToolContent("hello");
    expect(r).toEqual({ content: [{ type: "text", text: '"hello"' }] });
  });

  it("handles null without throwing", () => {
    const r = toToolContent(null);
    expect(r).toEqual({ content: [{ type: "text", text: "null" }] });
  });
});
