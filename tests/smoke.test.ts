import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(process.cwd(), "dist", "index.js");

describe("zeromind CLI", () => {
  it("prints help and status without a server", () => {
    const help = execFileSync("node", [BIN], { encoding: "utf8" });
    expect(help).toContain("zeromind link");
    // What the constraint means: nothing is started here. The remote `/mcp`
    // server the CLI writes an entry for is the thing help should name
    // plainly, so the word itself is not what is banned.
    expect(help).not.toMatch(/stdio|local server|spawn/i);

    const env = { ...process.env, ZEROMIND_CONFIG_DIR: join(process.cwd(), "tests", "no-such-dir") };
    const status = execFileSync("node", [BIN, "status"], { encoding: "utf8", env });
    expect(status).toContain("not linked");
  });

  it("names every command it dispatches", () => {
    const help = execFileSync("node", [BIN], { encoding: "utf8" });
    for (const command of ["link", "status", "unlink", "install", "upload", "open"]) {
      expect(help).toContain(`zeromind ${command}`);
    }
  });
});
