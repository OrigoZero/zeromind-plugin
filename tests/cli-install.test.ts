import { describe, it, expect, beforeEach } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { installHarness, listHarnesses, type Harness } from "../src/cli-install.js";
import { updateCache } from "../src/config.js";

const newTmp = (): string => mkdtempSync(join(tmpdir(), "zm-install-"));

/** Every file a step touched — some steps install a plugin BUNDLE (a directory). */
const collect = (p: string): string[] => {
  try {
    const st = statSync(p);
    if (st.isFile()) return [p];
    if (st.isDirectory()) return readdirSync(p).flatMap((c) => collect(join(p, c)));
  } catch {
    // A step can name a path it did not create.
  }
  return [];
};

const REMOTE_URL = "https://origozero.ai/mcp";

/** Point every home-anchored config path at `dir`. `os.homedir()` reads
 *  USERPROFILE on Windows and HOME elsewhere; APPDATA anchors VS Code's. */
const useHome = (dir: string): void => {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.APPDATA = join(dir, "AppData/Roaming");
};

describe("cli-install: per-harness full native install", () => {
  // The installer writes this machine's own install secret into each
  // harness's config, so every test runs against a linked cache of its own.
  beforeEach(() => {
    process.env.ZEROMIND_CONFIG_DIR = newTmp();
    updateCache({ install_id: "inst_test", install_secret: "ins_sec_test" });
  });

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
      "hermes",
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
    useHome(cwd);
    const r = await installHarness({ harness: "claude", scope: "project", cwd, shell: false });
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

    const mcpStep = r.steps.find((s) => s.label.startsWith("MCP server"))!;
    expect(mcpStep.status === "written" || mcpStep.status === "updated").toBe(true);
    const settings = JSON.parse(readFileSync(mcpStep.path!, "utf8")) as {
      mcpServers: { zeromind: { type: string; url: string; headers: Record<string, string> } };
      env: Record<string, string>;
    };
    // Claude Code expands `${VAR}` from its own settings `env`, so the
    // entry names the variable and the second step supplies the value.
    expect(settings.mcpServers.zeromind).toEqual({
      type: "http",
      url: "https://origozero.ai/mcp",
      headers: {
        Authorization: "Bearer ${ZEROMIND_INSTALL_SECRET}",
        "X-ZM-Harness": "claude-code",
      },
    });
    expect(settings.env.ZEROMIND_INSTALL_SECRET).toBe("ins_sec_test");
  });

  it("Cursor install copies the Cursor 3.0 plugin bundle to ~/.cursor/plugins/local/ + writes rule and mcp.json fallback", async () => {
    const cwd = newTmp();
    useHome(cwd);
    const r = await installHarness({ harness: "cursor", scope: "project", cwd, shell: false });
    // Native channel: the Cursor 3.0 plugin bundle.
    const pluginStep = r.steps.find((s) => s.label.includes("Cursor plugin"))!;
    expect(
      pluginStep.status === "written" || pluginStep.status === "exists" || pluginStep.status === "skipped",
    ).toBe(true);
    if (pluginStep.status === "written") {
      expect(pluginStep.path).toBe(join(cwd, ".cursor/plugins/local/zeromind"));
      const manifest = JSON.parse(
        readFileSync(join(pluginStep.path!, ".cursor-plugin/plugin.json"), "utf8"),
      ) as { name: string };
      expect(manifest.name).toBe("zeromind");
    }
    // Manual fallback: ~/.cursor/mcp.json + .cursor/rules/zeromind.mdc.
    const fb = r.steps.find((s) => s.label.includes("Manual fallback"))!;
    expect(fb.status === "written" || fb.status === "updated").toBe(true);
    const cfg = JSON.parse(readFileSync(fb.path!, "utf8")) as {
      mcpServers: { zeromind: { url: string; headers: Record<string, string> } };
    };
    // Cursor's HTTP form is url + headers, with no `type` discriminator.
    expect(cfg.mcpServers.zeromind).toEqual({
      url: "https://origozero.ai/mcp",
      headers: {
        Authorization: "Bearer ins_sec_test",
        "X-ZM-Harness": "cursor",
      },
    });
    // The fallback also wrote the rule alongside.
    const rulePath = join(cwd, ".cursor/rules/zeromind.mdc");
    const ruleBody = readFileSync(rulePath, "utf8");
    expect(ruleBody).toMatch(/^---\ndescription: /);
    expect(ruleBody).toMatch(/alwaysApply: false/);
  });

  it("Hermes install writes mcp_servers.zeromind to ~/.hermes/config.yaml + drops the optional plugin bundle", async () => {
    const cwd = newTmp();
    useHome(cwd);
    const r = await installHarness({ harness: "hermes", cwd, shell: false });
    // Canonical channel: config.yaml MCP entry.
    const mcpStep = r.steps.find((s) => s.label.includes("config.yaml"))!;
    expect(mcpStep.status === "written" || mcpStep.status === "updated").toBe(true);
    expect(mcpStep.path).toBe(join(cwd, ".hermes/config.yaml"));
    // Hermes reads mcp_servers as a MAPPING keyed by server name (it
    // iterates with `.items()`), so it must be a dict — never a YAML list,
    // which crashes the CLI (issue #44).
    const YAML = await import("yaml");
    const cfg = YAML.parse(readFileSync(mcpStep.path!, "utf8")) as {
      mcp_servers: Record<
        string,
        { type: string; url: string; headers: Record<string, string> }
      >;
    };
    expect(Array.isArray(cfg.mcp_servers)).toBe(false);
    expect(cfg.mcp_servers.zeromind).toEqual({
      type: "streamable_http",
      url: "https://origozero.ai/mcp",
      headers: {
        Authorization: "Bearer ins_sec_test",
        "X-ZM-Harness": "hermes",
      },
    });
    // The key carries the name — no redundant `name` field inside the entry.
    expect("name" in cfg.mcp_servers.zeromind).toBe(false);
    // Optional plugin bundle with skills + slash command + context hook.
    const plugin = r.steps.find((s) => s.label.includes("Plugin bundle"))!;
    if (plugin.status === "written") {
      expect(plugin.path).toBe(join(cwd, ".hermes/plugins/zeromind"));
      expect(readFileSync(join(plugin.path!, "plugin.yaml"), "utf8")).toMatch(
        /name: zeromind/,
      );
      expect(readFileSync(join(plugin.path!, "__init__.py"), "utf8")).toMatch(
        /def register\(ctx\)/,
      );
    }
  });

  it("Hermes install self-heals a config an older build corrupted into the list shape, preserving other servers", async () => {
    const cwd = newTmp();
    useHome(cwd);
    const YAML = await import("yaml");
    const cfgPath = join(cwd, ".hermes/config.yaml");
    // Reproduce the 0.6.0 corruption: mcp_servers as a LIST, plus an
    // unrelated server the user added that we must not drop.
    mkdirSync(join(cwd, ".hermes"), { recursive: true });
    writeFileSync(
      cfgPath,
      YAML.stringify({
        mcp_servers: [
          { name: "other", command: "other-cmd", args: ["x"] },
          { name: "zeromind", command: "npx", args: ["-y", "stale"] },
        ],
      }),
    );

    const r = await installHarness({ harness: "hermes", cwd, shell: false });
    const mcpStep = r.steps.find((s) => s.label.includes("config.yaml"))!;
    expect(mcpStep.status).toBe("updated");

    const cfg = YAML.parse(readFileSync(cfgPath, "utf8")) as {
      mcp_servers: Record<string, { command?: string; url?: string }>;
    };
    // Healed into a mapping…
    expect(Array.isArray(cfg.mcp_servers)).toBe(false);
    // …with the unrelated server re-keyed and preserved…
    expect(cfg.mcp_servers.other.command).toBe("other-cmd");
    expect("name" in cfg.mcp_servers.other).toBe(false);
    // …and the zeromind entry upgraded to the remote server.
    expect(cfg.mcp_servers.zeromind.url).toBe("https://origozero.ai/mcp");
    expect("command" in cfg.mcp_servers.zeromind).toBe(false);
  });

  it("Codex install copies the .codex-plugin bundle to the personal marketplace + writes config.toml fallback + AGENTS.md", async () => {
    const cwd = newTmp();
    useHome(cwd);
    const r = await installHarness({ harness: "codex", scope: "global", cwd, shell: false });
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
      expect(toml).toMatch(/url = "https:\/\/origozero\.ai\/mcp"/);
      expect(toml).toMatch(/"Authorization" = "Bearer ins_sec_test"/);
      expect(toml).toMatch(/"X-ZM-Harness" = "codex"/);
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
    useHome(cwd);
    const agentsPath = join(cwd, "AGENTS.md");
    writeFileSync(agentsPath, "## project conventions\n- run tests\n");
    await installHarness({ harness: "codex", scope: "project", cwd, shell: false });
    await installHarness({ harness: "codex", scope: "project", cwd, shell: false });
    await installHarness({ harness: "codex", scope: "project", cwd, shell: false });
    const body = readFileSync(agentsPath, "utf8");
    expect((body.match(/<!-- BEGIN ZEROMIND -->/g) ?? []).length).toBe(1);
    expect((body.match(/<!-- END ZEROMIND -->/g) ?? []).length).toBe(1);
    expect(body).toMatch(/## project conventions/);
    expect(body).toMatch(/- run tests/);
  });

  it("shell: false never runs the harness's own CLI, even when it is first on PATH", async () => {
    // A child process resolves its own home directory, so a step that shells
    // out writes where useHome() has no say — a Codex that grows `--header`
    // would otherwise put a test's bearer in the developer's real
    // ~/.codex/config.toml. `shell: false` is what keeps a run off that path.
    //
    // The fake `codex` is a copy of this very node binary, so it is genuinely
    // spawnable on every platform (a .cmd/.sh stand-in is not: execFileSync
    // refuses both without a shell). NODE_OPTIONS is inherited by children, so
    // ANY spawn of it — the `--help` probe included — leaves the marker.
    const cwd = newTmp();
    useHome(cwd);
    const binDir = newTmp();
    const marker = join(binDir, "spawned");
    const hook = join(binDir, "hook.cjs");
    writeFileSync(hook, `require("fs").writeFileSync(${JSON.stringify(marker)}, "1");\n`);
    copyFileSync(process.execPath, join(binDir, platform() === "win32" ? "codex.exe" : "codex"));
    const path0 = process.env.PATH;
    const nodeOptions0 = process.env.NODE_OPTIONS;
    process.env.PATH = binDir + delimiter + (path0 ?? "");
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(hook)}`;
    try {
      const r = await installHarness({ harness: "codex", scope: "global", cwd, shell: false });
      expect(existsSync(marker), "the install spawned a harness CLI").toBe(false);
      const toml = r.steps.find((s) => s.label.includes("config.toml"))!;
      expect(toml.path).toBe(join(cwd, ".codex/config.toml"));
      const body = readFileSync(toml.path!, "utf8");
      expect(body).toMatch(/url = "https:\/\/origozero\.ai\/mcp"/);
      expect(body).toMatch(/"Authorization" = "Bearer ins_sec_test"/);
    } finally {
      process.env.PATH = path0;
      if (nodeOptions0 === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = nodeOptions0;
    }
  });

  it("shell: true does reach that CLI — the gate above is a gate", async () => {
    // The inverse of the case above: with the same fake first on PATH and the
    // shell allowed, the `codex mcp add --help` probe spawns it. (The probe
    // finds no --header in a node binary's output, so the step still writes
    // the file — what is asserted here is that the child ran at all.)
    const cwd = newTmp();
    useHome(cwd);
    const binDir = newTmp();
    const marker = join(binDir, "spawned");
    const hook = join(binDir, "hook.cjs");
    writeFileSync(hook, `require("fs").writeFileSync(${JSON.stringify(marker)}, "1");\n`);
    copyFileSync(process.execPath, join(binDir, platform() === "win32" ? "codex.exe" : "codex"));
    const path0 = process.env.PATH;
    const nodeOptions0 = process.env.NODE_OPTIONS;
    process.env.PATH = binDir + delimiter + (path0 ?? "");
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(hook)}`;
    try {
      await installHarness({ harness: "codex", scope: "global", cwd, shell: true });
      expect(existsSync(marker), "the shell path never reached the CLI").toBe(true);
    } finally {
      process.env.PATH = path0;
      if (nodeOptions0 === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = nodeOptions0;
    }
  });

  it("Gemini install merges MCP server JSON without nuking other entries", async () => {
    const cwd = newTmp();
    useHome(cwd);
    // Pre-write Gemini settings with an unrelated MCP server.
    const settingsPath = join(cwd, ".gemini/settings.json");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cwd, ".gemini"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ mcpServers: { other: { command: "other-cmd" } } }, null, 2),
    );
    await installHarness({ harness: "gemini", scope: "global", cwd, shell: false });
    const after = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      mcpServers: {
        other: { command: string };
        zeromind: { httpUrl: string; headers: Record<string, string> };
      };
    };
    expect(after.mcpServers.other.command).toBe("other-cmd");
    // Gemini CLI names a streamable-HTTP server's address `httpUrl`.
    expect(after.mcpServers.zeromind.httpUrl).toBe("https://origozero.ai/mcp");
    expect(after.mcpServers.zeromind.headers.Authorization).toBe("Bearer ins_sec_test");
  });

  it("Aider install adds CONVENTIONS.md to the .aider.conf.yml `read:` list (and is idempotent)", async () => {
    const cwd = newTmp();
    useHome(cwd);
    await installHarness({ harness: "aider", scope: "project", cwd, shell: false });
    await installHarness({ harness: "aider", scope: "project", cwd, shell: false });
    const yaml = readFileSync(join(cwd, ".aider.conf.yml"), "utf8");
    // CONVENTIONS.md should appear exactly once.
    expect((yaml.match(/CONVENTIONS\.md/g) ?? []).length).toBe(1);
    const convs = readFileSync(join(cwd, "CONVENTIONS.md"), "utf8");
    expect(convs).toMatch(/<!-- BEGIN ZEROMIND -->/);
  });

  it("Zed install copies the extension bundle + falls back to context_server in settings.json", async () => {
    const cwd = newTmp();
    useHome(cwd);
    const r = await installHarness({ harness: "zed", scope: "project", cwd, shell: false });
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
      "goose",
      "junie",
      "amp",
      "hermes",
    ];
    for (const h of harnesses) {
      const cwd = newTmp();
      useHome(cwd);
      const r = await installHarness({ harness: h, cwd, shell: false });
      const filePaths = r.steps.map((s) => s.path).filter(Boolean) as string[];
      // Each harness ships some form of the operating manual (either the
      // canonical condensed text or the long-form skill content). Common
      // to both: the find-before-build rule via `zeromind.search`.
      const files = filePaths.flatMap(collect);
      const anyManualContent = files
        .map((p) => readFileSync(p, "utf8"))
        .some((b) => /zeromind\.search/.test(b));
      expect(anyManualContent, `${h} should land the operating manual in some file`).toBe(true);
    }
  });

  it("every harness gets the remote /mcp entry and never an npx command", async () => {
    for (const h of listHarnesses()) {
      const cwd = newTmp();
      useHome(newTmp());
      const report = await installHarness({
        harness: h.harness,
        cwd,
        scope: h.defaultScope,
        force: true,
        shell: false,
      });
      const wrote = report.steps.filter(
        (s) => s.path && (s.status === "written" || s.status === "updated"),
      );
      // Which files are MCP configs is the step's own answer: an
      // instructions step writes a harness's agent-facing channel (Goose's
      // `.goosehints` has no `.md` to give it away), a config step writes an
      // MCP entry, and a bundle carries both — inside one, only the manual's
      // own `.md` is prose. A step that declares nothing fails here rather
      // than slipping past the guard below.
      for (const s of wrote) {
        expect(s.kind, `${h.harness}: step '${s.label}' declares no kind`).toBeDefined();
      }
      const configs = wrote
        .filter((s) => s.kind !== "instructions")
        .flatMap((s) => collect(s.path!))
        .filter((p) => !/\.(md|mdc)$/i.test(p));
      const written = configs.map((p) => readFileSync(p, "utf8")).join("\n");
      // A harness whose MCP entry point is unconfirmed (openClaw, Aider)
      // carries the same server in the note the install prints instead.
      const notes = report.steps
        .filter((s) => s.status === "manual")
        .map((s) => s.note ?? "")
        .join("\n");
      expect(
        written.includes(REMOTE_URL) || notes.includes(REMOTE_URL),
        `${h.harness}: no ${REMOTE_URL} entry written, and none in a manual note`,
      ).toBe(true);
      expect(written + notes, h.harness).toContain("X-ZM-Harness");
      if (written.includes(REMOTE_URL)) {
        // The bearer is either this machine's secret or the variable the
        // harness expands to it — never absent.
        expect(written, h.harness).toMatch(/ins_sec_test|ZEROMIND_INSTALL_SECRET/);
      }
      // No config the install writes, and no instruction it prints, spawns
      // anything locally. An instructions file may name the `zeromind` CLI
      // the agent asks the user to run, so it is written but not asserted on.
      for (const p of configs) {
        expect(readFileSync(p, "utf8"), `${h.harness}: ${p}`).not.toContain("npx");
      }
      expect(notes, h.harness).not.toContain("npx");
    }
  });

  it("rejects unknown harnesses", async () => {
    const cwd = newTmp();
    await expect(
      installHarness({ harness: "notahost" as Harness, cwd, shell: false }),
    ).rejects.toThrow(/unknown harness/);
  });
});
