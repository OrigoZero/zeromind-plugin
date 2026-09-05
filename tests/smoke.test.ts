import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const BIN = join(process.cwd(), "dist", "index.js");

describe("zeromind CLI", () => {
  it("prints help and status without a server", () => {
    const help = execFileSync("node", [BIN], { encoding: "utf8" });
    expect(help).toContain("zeromind link");
    expect(help).not.toMatch(/stdio|server/i);

    const env = { ...process.env, ZEROMIND_CONFIG_DIR: join(process.cwd(), "tests", "no-such-dir") };
    const status = execFileSync("node", [BIN, "status"], { encoding: "utf8", env });
    expect(status).toContain("not linked");
  });

  it("names every command it dispatches", () => {
    const help = execFileSync("node", [BIN], { encoding: "utf8" });
    for (const command of ["link", "status", "unlink", "install"]) {
      expect(help).toContain(`zeromind ${command}`);
    }
  });
});
