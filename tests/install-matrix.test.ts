import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listHarnesses } from "../src/cli-install.js";

const repoRoot = join(__dirname, "..");

describe("install matrix (UI agent briefing source of truth)", () => {
  const matrix = JSON.parse(
    readFileSync(join(repoRoot, "docs/install-matrix.json"), "utf8"),
  ) as {
    version: string;
    harnesses: {
      id: string;
      display_name: string;
      category: string;
      tools_available: boolean;
      prerequisites: string[];
      primary_install: { kind: string };
      native_channel: string;
      doc_url: string;
    }[];
  };

  it("matrix.version matches package.json version", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };
    expect(matrix.version).toBe(pkg.version);
  });

  it("every harness listed by the installer has a matrix entry", () => {
    const installerIds = listHarnesses().map((h) => h.harness);
    const matrixIds = matrix.harnesses.map((h) => h.id);
    for (const id of installerIds) {
      expect(matrixIds, `installer harness '${id}' is missing from install-matrix.json`).toContain(id);
    }
  });

  it("matrix includes the generic 'other' fallback row", () => {
    const ids = matrix.harnesses.map((h) => h.id);
    expect(ids).toContain("other");
  });

  it("every entry has the required UI fields", () => {
    const allowedCategories = new Set([
      "cli-agent",
      "ide",
      "ide-extension",
      "personal-agent",
      "generic",
    ]);
    const allowedKinds = new Set([
      "shell",
      "in-app-command",
      "deeplink",
      "marketplace",
      "config-snippet",
    ]);
    for (const h of matrix.harnesses) {
      expect(h.display_name.length).toBeGreaterThan(0);
      expect(allowedCategories.has(h.category), `${h.id}: bad category ${h.category}`).toBe(true);
      expect(typeof h.tools_available).toBe("boolean");
      expect(Array.isArray(h.prerequisites)).toBe(true);
      expect(h.native_channel.length).toBeGreaterThan(0);
      expect(h.doc_url).toMatch(/^https:\/\//);
      expect(allowedKinds.has(h.primary_install.kind), `${h.id}: bad kind ${h.primary_install.kind}`).toBe(true);
    }
  });
});
