import { describe, it, expect } from "vitest";
import { spillLargeText } from "../src/spill.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("spillLargeText", () => {
  it("returns small text unchanged", () => {
    expect(spillLargeText("hi", "execute")).toBe("hi");
  });

  it("spills >16KB to a tmp file with preview + pointer", () => {
    const big = "x".repeat(20_000);
    const out = spillLargeText(big, "execute");
    expect(out.length).toBeLessThan(4_000);
    expect(out).toContain("output truncated");
    const m = out.match(/saved to (.+?);/);
    expect(m).toBeTruthy();
    expect(fs.readFileSync(m![1], "utf8")).toBe(big);
    expect(
      m![1].startsWith(path.join(os.tmpdir(), "zeromind-mcp-returns")),
    ).toBe(true);
  });

  it("prunes old spill files beyond the newest 50", () => {
    const dir = path.join(os.tmpdir(), "zeromind-mcp-returns");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(dir, `prunetest-${i}.txt`), "x");
    }
    spillLargeText("y".repeat(20_000), "bash");
    expect(fs.readdirSync(dir).length).toBeLessThanOrEqual(51);
  });
});
