import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHarness, listHarnesses, type Harness } from "../src/cli-install.js";

const newTmp = (): string => mkdtempSync(join(tmpdir(), "zm-install-"));

describe("cli-install", () => {
  it("lists every harness with at least one scope and the canonical channel", () => {
    const harnesses = listHarnesses();
    expect(harnesses.length).toBeGreaterThanOrEqual(14);
    const names = harnesses.map((h) => h.harness);
    // Custom-crafted integrations the research surfaced:
    for (const expected of [
      "claude",
      "cursor",
      "codex",
      "gemini",
      "opencode",
      "cline",
      "continue",
      "windsurf",
      "zed",
      "openclaw",
      "aider",
      "copilot",
      "goose",
      "junie",
      "amp",
    ] as const) {
      expect(names).toContain(expected);
    }
    for (const h of harnesses) {
      expect(h.scopes.length).toBeGreaterThan(0);
      expect(h.scopes).toContain(h.defaultScope);
      expect(h.channel.length).toBeGreaterThan(10);
    }
  });

  it("writes a Claude Code skill with the YAML frontmatter Claude Code expects", () => {
    const cwd = newTmp();
    const r = installHarness({ harness: "claude", scope: "project", cwd });
    expect(r.status).toBe("written");
    expect(r.path).toBe(join(cwd, ".claude/skills/zeromind/SKILL.md"));
    const body = readFileSync(r.path, "utf8");
    expect(body.startsWith("---\nname: zeromind\n")).toBe(true);
    expect(body).toMatch(/description: ZeroMind/);
    expect(body).toMatch(/zeromind\.search/);
  });

  it("writes a Cursor .mdc with the description+alwaysApply frontmatter Cursor expects", () => {
    const cwd = newTmp();
    const r = installHarness({ harness: "cursor", cwd });
    expect(r.path).toBe(join(cwd, ".cursor/rules/zeromind.mdc"));
    const body = readFileSync(r.path, "utf8");
    expect(body).toMatch(/^---\ndescription: /);
    expect(body).toMatch(/alwaysApply: false/);
  });

  it("appends a delimited ZeroMind block to an existing AGENTS.md (Codex/Windsurf/Junie convention)", () => {
    const cwd = newTmp();
    const agentsPath = join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "## project\n- run npm test\n");
    const r = installHarness({ harness: "codex", scope: "project", cwd });
    expect(r.status).toBe("updated");
    const body = readFileSync(agentsPath, "utf8");
    expect(body).toMatch(/## project/);
    expect(body).toMatch(/- run npm test/);
    expect(body).toMatch(/<!-- BEGIN ZEROMIND -->/);
    expect(body).toMatch(/<!-- END ZEROMIND -->/);
    expect(body).toMatch(/zeromind\.search/);
  });

  it("re-running an install on a shared file replaces the ZeroMind block without duplicating it", () => {
    const cwd = newTmp();
    const path = join(cwd, "AGENTS.md");
    writeFileSync(path, "## project rules\n- a\n");
    installHarness({ harness: "codex", scope: "project", cwd });
    installHarness({ harness: "codex", scope: "project", cwd });
    installHarness({ harness: "codex", scope: "project", cwd });
    const body = readFileSync(path, "utf8");
    expect((body.match(/<!-- BEGIN ZEROMIND -->/g) ?? []).length).toBe(1);
    expect((body.match(/<!-- END ZEROMIND -->/g) ?? []).length).toBe(1);
    // User content survives:
    expect(body).toMatch(/## project rules/);
    expect(body).toMatch(/- a/);
  });

  it("skips an owned file when it already exists, unless --force", () => {
    const cwd = newTmp();
    const r1 = installHarness({ harness: "cursor", cwd });
    expect(r1.status).toBe("written");
    const r2 = installHarness({ harness: "cursor", cwd });
    expect(r2.status).toBe("exists");
    const r3 = installHarness({ harness: "cursor", cwd, force: true });
    expect(r3.status).toBe("written");
  });

  it("each harness writes the canonical manual body (single source of truth)", () => {
    const harnesses: Harness[] = [
      "claude",
      "cursor",
      "codex",
      "gemini",
      "opencode",
      "cline",
      "continue",
      "windsurf",
      "zed",
      "openclaw",
      "aider",
      "copilot",
      "junie",
      "amp",
    ];
    for (const h of harnesses) {
      const cwd = newTmp();
      const r = installHarness({ harness: h, scope: "project", cwd });
      const body = readFileSync(r.path, "utf8");
      expect(body, `${h} manual missing zeromind.search`).toMatch(/zeromind\.search/);
      expect(body, `${h} manual missing find-before-build rule`).toMatch(
        /check ZeroMind FIRST/i,
      );
    }
  });

  it("rejects an unknown harness", () => {
    const cwd = newTmp();
    expect(() =>
      installHarness({ harness: "notahost" as Harness, cwd }),
    ).toThrow(/unknown harness/);
  });
});
