import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHarness, listHarnesses, type Harness } from "../src/cli-install.js";

const newTmp = (): string => mkdtempSync(join(tmpdir(), "zm-install-"));

describe("cli-install: per-harness full native install", () => {
  it("lists every harness with at least one scope, a channel, and steps", () => {
    const harnesses = listHarnesses();
    const names = harnesses.map((h) => h.harness);
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
      expect(h.stepCount).toBeGreaterThan(0);
    }
  });

  it("Claude install drops both bundled skills + adds the MCP server to ~/.claude/settings.json (one shot)", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    const r = await installHarness({ harness: "claude", scope: "project", cwd });
    const gettingStarted = r.steps.find((s) => s.label.includes("getting-started"))!;
    const library = r.steps.find((s) => s.label.includes("library"))!;
    expect(gettingStarted.status).toBe("written");
    expect(library.status).toBe("written");
    expect(gettingStarted.path).toBe(
      join(cwd, ".claude/skills/zeromind-getting-started/SKILL.md"),
    );
    const skill = readFileSync(gettingStarted.path!, "utf8");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/zeromind\.search/);

    const mcpStep = r.steps.find((s) => s.label.includes("settings.json"))!;
    expect(mcpStep.status === "written" || mcpStep.status === "updated").toBe(true);
    const settings = JSON.parse(readFileSync(mcpStep.path!, "utf8")) as {
      mcpServers: { zeromind: { command: string; args: string[]; env: unknown } };
    };
    expect(settings.mcpServers.zeromind.command).toBe("npx");
    expect(settings.mcpServers.zeromind.args).toEqual(["-y", "@origozero/zeromind"]);
  });

  it("Cursor install writes the rule + adds the MCP server to ~/.cursor/mcp.json", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    const r = await installHarness({ harness: "cursor", scope: "project", cwd });
    const rule = r.steps.find((s) => s.label.includes("rule"))!;
    expect(rule.status).toBe("written");
    expect(rule.path).toBe(join(cwd, ".cursor/rules/zeromind.mdc"));
    const ruleBody = readFileSync(rule.path!, "utf8");
    expect(ruleBody).toMatch(/^---\ndescription: /);
    expect(ruleBody).toMatch(/alwaysApply: false/);

    const mcp = r.steps.find((s) => s.label.includes("mcp.json"))!;
    expect(mcp.status === "written" || mcp.status === "updated").toBe(true);
    const cfg = JSON.parse(readFileSync(mcp.path!, "utf8")) as {
      mcpServers: { zeromind: { env: { ZEROMIND_IDE_NAME: string } } };
    };
    expect(cfg.mcpServers.zeromind.env.ZEROMIND_IDE_NAME).toBe("cursor");
  });

  it("Codex install copies the .codex-plugin bundle to the personal marketplace + writes config.toml fallback + AGENTS.md", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    const r = await installHarness({ harness: "codex", scope: "global", cwd });
    // Native channel: the Codex plugin bundle (skills + .mcp.json + .codex-plugin/plugin.json).
    const pluginStep = r.steps.find((s) => s.label.includes("personal marketplace"))!;
    expect(
      pluginStep.status === "written" || pluginStep.status === "exists" || pluginStep.status === "skipped",
    ).toBe(true);
    if (pluginStep.status === "written") {
      expect(pluginStep.path).toBe(
        join(cwd, ".codex/marketplaces/personal/zeromind"),
      );
      const manifest = JSON.parse(
        readFileSync(join(pluginStep.path!, ".codex-plugin/plugin.json"), "utf8"),
      ) as { name: string; skills: string; mcpServers: string };
      expect(manifest.name).toBe("zeromind");
      expect(manifest.skills).toBe("./skills");
      expect(manifest.mcpServers).toBe("./.mcp.json");
    }
    // Manual-fallback: config.toml (in absence of the codex CLI).
    const tomlStep = r.steps.find((s) => s.label.includes("config.toml"))!;
    if (tomlStep.path) {
      const toml = readFileSync(tomlStep.path, "utf8");
      expect(toml).toMatch(/\[mcp_servers\.zeromind\]/);
      expect(toml).toMatch(/@origozero\/zeromind/);
    }
    // Complementary AGENTS.md for projects that want project-level context.
    const agentsStep = r.steps.find((s) => s.label.includes("AGENTS.md"))!;
    expect(agentsStep.path).toBe(join(cwd, ".codex/AGENTS.md"));
    const agents = readFileSync(agentsStep.path!, "utf8");
    expect(agents).toMatch(/<!-- BEGIN ZEROMIND -->/);
    expect(agents).toMatch(/zeromind\.search/);
  });

  it("re-running Codex install is idempotent (one BEGIN block, user content preserved)", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    const agentsPath = join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "## project conventions\n- run tests\n");
    await installHarness({ harness: "codex", scope: "project", cwd });
    await installHarness({ harness: "codex", scope: "project", cwd });
    await installHarness({ harness: "codex", scope: "project", cwd });
    const body = readFileSync(agentsPath, "utf8");
    expect((body.match(/<!-- BEGIN ZEROMIND -->/g) ?? []).length).toBe(1);
    expect((body.match(/<!-- END ZEROMIND -->/g) ?? []).length).toBe(1);
    expect(body).toMatch(/## project conventions/);
    expect(body).toMatch(/- run tests/);
  });

  it("Gemini install merges MCP server JSON without nuking other entries", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    // Pre-write Gemini settings with an unrelated MCP server.
    const settingsPath = join(cwd, ".gemini/settings.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cwd, ".gemini"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ mcpServers: { other: { command: "other-cmd" } } }, null, 2),
    );
    await installHarness({ harness: "gemini", scope: "global", cwd });
    const after = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      mcpServers: { other: { command: string }; zeromind: { command: string } };
    };
    expect(after.mcpServers.other.command).toBe("other-cmd");
    expect(after.mcpServers.zeromind.command).toBe("npx");
  });

  it("Aider install adds CONVENTIONS.md to the .aider.conf.yml `read:` list (and is idempotent)", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    await installHarness({ harness: "aider", scope: "project", cwd });
    await installHarness({ harness: "aider", scope: "project", cwd });
    const yaml = readFileSync(join(cwd, ".aider.conf.yml"), "utf8");
    // CONVENTIONS.md should appear exactly once.
    expect((yaml.match(/CONVENTIONS\.md/g) ?? []).length).toBe(1);
    const convs = readFileSync(join(cwd, "CONVENTIONS.md"), "utf8");
    expect(convs).toMatch(/<!-- BEGIN ZEROMIND -->/);
  });

  it("Zed install copies the extension bundle + falls back to context_server in settings.json", async () => {
    const cwd = newTmp();
    process.env.HOME = cwd;
    const r = await installHarness({ harness: "zed", scope: "project", cwd });
    // Native channel: the Zed extension bundle (extension.toml with context_servers.zeromind).
    const extStep = r.steps.find((s) => s.label.includes("Zed extension"))!;
    expect(
      extStep.status === "written" || extStep.status === "exists" || extStep.status === "skipped",
    ).toBe(true);
    if (extStep.status === "written") {
      const toml = readFileSync(join(extStep.path!, "extension.toml"), "utf8");
      expect(toml).toMatch(/id = "zeromind"/);
      expect(toml).toMatch(/context_servers\.zeromind/);
    }
    // Manual fallback: settings.json edit.
    const mcp = r.steps.find((s) => s.label.includes("settings.json"))!;
    const settings = readFileSync(mcp.path!, "utf8");
    expect(settings).toMatch(/context_servers/);
    expect(settings).toMatch(/zeromind/);
  });

  it("every harness's MANUAL ends up reachable through at least one step", async () => {
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
      process.env.HOME = cwd;
      const r = await installHarness({ harness: h, cwd });
      const filePaths = r.steps.map((s) => s.path).filter(Boolean) as string[];
      // Each harness ships some form of the operating manual (either the
      // canonical condensed text or the long-form skill content). Common
      // to both: the find-before-build rule via `zeromind.search`. Some
      // harnesses install plugin BUNDLES (directories); walk them shallow.
      const { statSync, readdirSync } = await import("node:fs");
      const collect = (p: string): string[] => {
        try {
          const st = statSync(p);
          if (st.isFile()) return [p];
          if (st.isDirectory()) {
            return readdirSync(p).flatMap((c) => collect(join(p, c)));
          }
        } catch {
          // ignore
        }
        return [];
      };
      const files = filePaths.flatMap(collect);
      const anyManualContent = files
        .map((p) => readFileSync(p, "utf8"))
        .some((b) => /zeromind\.search/.test(b));
      expect(anyManualContent, `${h} should land the operating manual in some file`).toBe(true);
    }
  });

  it("rejects unknown harnesses", async () => {
    const cwd = newTmp();
    await expect(
      installHarness({ harness: "notahost" as Harness, cwd }),
    ).rejects.toThrow(/unknown harness/);
  });
});
