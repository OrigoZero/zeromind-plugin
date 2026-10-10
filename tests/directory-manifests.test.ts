import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

// The plugin directories read their manifest from the repo root: the Gemini CLI
// gallery wants `gemini-extension.json` there, Codex wants `.codex-plugin/plugin.json`,
// Cursor wants `.cursor-plugin/`. The bundles under `dist-publishing/` are what
// `zeromind install <harness>` copies onto a machine. Nothing generates either
// set, so this suite is what keeps them saying the same thing.

const repoRoot = join(__dirname, "..");
const HOMEPAGE = "https://origozero.ai/mcp-server";
const MCP_URL = "https://origozero.ai/mcp";

type Json = Record<string, unknown>;

const text = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
const json = (rel: string): Json => JSON.parse(text(rel)) as Json;

/** Every file under `dir`, keyed by its path relative to `dir`. */
const tree = (dir: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs).sort()) {
      const child = join(abs, name);
      if (statSync(child).isDirectory()) walk(child);
      else out.set(relative(join(repoRoot, dir), child), readFileSync(child, "utf8"));
    }
  };
  walk(join(repoRoot, dir));
  return out;
};

/** A path a manifest may name: relative, no `..`, and it stays under `base`. */
const insideAndPresent = (base: string, path: string): boolean => {
  if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes("..")) return false;
  const abs = resolve(repoRoot, base, path);
  return abs.startsWith(resolve(repoRoot, base)) && existsSync(abs);
};

/** The YAML frontmatter keys of a rule or skill file. */
const frontmatter = (body: string): Json => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(body);
  return match ? (parseYaml(match[1]) as Json) : {};
};

const CLAUDE = ".claude-plugin/plugin.json";
const CLAUDE_MARKET = ".claude-plugin/marketplace.json";
const GEMINI = "gemini-extension.json";
const GEMINI_BUNDLE = "dist-publishing/gemini-extension/zeromind";
const CODEX = ".codex-plugin/plugin.json";
const CODEX_BUNDLE = "dist-publishing/codex-plugin";
const CURSOR_MARKET = ".cursor-plugin/marketplace.json";
const CURSOR_BUNDLE = "dist-publishing/cursor-plugin";

const claudeEntry = (): Json => (json(CLAUDE_MARKET).plugins as Json[])[0];

describe("directory manifests", () => {
  it("every manifest carries package.json's version", () => {
    const { version } = json("package.json");
    const versions: Record<string, unknown> = {
      [CLAUDE]: json(CLAUDE).version,
      [CLAUDE_MARKET]: claudeEntry().version,
      [GEMINI]: json(GEMINI).version,
      [`${GEMINI_BUNDLE}/gemini-extension.json`]: json(`${GEMINI_BUNDLE}/gemini-extension.json`)
        .version,
      [CODEX]: json(CODEX).version,
      [`${CODEX_BUNDLE}/${CODEX}`]: json(`${CODEX_BUNDLE}/${CODEX}`).version,
      [`${CURSOR_BUNDLE}/.cursor-plugin/plugin.json`]: json(
        `${CURSOR_BUNDLE}/.cursor-plugin/plugin.json`,
      ).version,
    };
    for (const [file, found] of Object.entries(versions)) {
      expect(found, `${file} is out of step with package.json`).toBe(version);
    }
  });

  it("every homepage is the MCP server page", () => {
    const homepages: Record<string, unknown> = {
      "package.json": json("package.json").homepage,
      [CLAUDE]: json(CLAUDE).homepage,
      [CLAUDE_MARKET]: claudeEntry().homepage,
      [CODEX]: json(CODEX).homepage,
      [`${CODEX_BUNDLE}/${CODEX}`]: json(`${CODEX_BUNDLE}/${CODEX}`).homepage,
      [`${CURSOR_BUNDLE}/.cursor-plugin/plugin.json`]: json(
        `${CURSOR_BUNDLE}/.cursor-plugin/plugin.json`,
      ).homepage,
      "dist-publishing/clawhub/zeromind/clawhub.json": json(
        "dist-publishing/clawhub/zeromind/clawhub.json",
      ).homepage,
      "dist-publishing/hermes-catalog/manifest.yaml": (
        parseYaml(text("dist-publishing/hermes-catalog/manifest.yaml")) as Json
      ).homepage,
    };
    for (const [file, found] of Object.entries(homepages)) {
      expect(found, `${file} homepage`).toBe(HOMEPAGE);
    }
  });

  it("ships the MIT licence every manifest declares, and a security policy", () => {
    const pkg = json("package.json");
    expect(pkg.license).toBe("MIT");
    expect(pkg.files).toContain("LICENSE");
    expect(json(CLAUDE).license).toBe("MIT");
    expect(json(CODEX).license).toBe("MIT");
    const licence = text("LICENSE");
    expect(licence.startsWith("MIT License\n")).toBe(true);
    expect(licence).toMatch(/^Copyright \(c\) \d{4} OrigoZero$/m);
    expect(text("SECURITY.md")).toContain(
      "https://github.com/OrigoZero/zeromind-plugin/security/advisories/new",
    );
  });
});

describe("Gemini CLI extension at the repo root", () => {
  const root = json(GEMINI);
  const bundle = json(`${GEMINI_BUNDLE}/gemini-extension.json`);

  it("is the bundle's manifest, apart from where the context file lives", () => {
    expect({ ...root, contextFileName: bundle.contextFileName }).toEqual(bundle);
    expect(root.name).toMatch(/^[a-zA-Z0-9-]+$/);
  });

  it("names a context file that exists and is the one the bundle carries", () => {
    const rootContext = root.contextFileName as string;
    const bundleContext = bundle.contextFileName as string;
    expect(insideAndPresent(".", rootContext), rootContext).toBe(true);
    expect(insideAndPresent(GEMINI_BUNDLE, bundleContext), bundleContext).toBe(true);
    expect(text(rootContext)).toBe(text(join(GEMINI_BUNDLE, bundleContext)));
  });

  it("points at /mcp", () => {
    const servers = root.mcpServers as Record<string, Json>;
    expect(servers.zeromind.httpUrl).toBe(MCP_URL);
  });
});

describe("Codex plugin at the repo root", () => {
  const root = json(CODEX);
  const bundle = json(`${CODEX_BUNDLE}/${CODEX}`);

  it("is the bundle's manifest, apart from where the MCP config lives", () => {
    expect({ ...root, mcpServers: bundle.mcpServers }).toEqual(bundle);
  });

  it("names component paths Codex accepts, and they resolve from each plugin root", () => {
    for (const [base, manifest] of [
      [".", root],
      [CODEX_BUNDLE, bundle],
    ] as const) {
      for (const field of ["skills", "mcpServers"]) {
        const path = manifest[field] as string;
        // Codex ignores a component path that does not start with `./`.
        expect(path.startsWith("./"), `${base}: ${field} = ${path}`).toBe(true);
        expect(insideAndPresent(base, path), `${base}: ${field} = ${path}`).toBe(true);
      }
    }
  });

  it("reads the same MCP config and the same skills as the bundle", () => {
    expect(resolve(repoRoot, root.mcpServers as string)).toBe(
      resolve(repoRoot, CODEX_BUNDLE, bundle.mcpServers as string),
    );
    const servers = json(root.mcpServers as string).mcpServers as Record<string, Json>;
    expect(servers.zeromind.url).toBe(MCP_URL);
    expect(tree(join(CODEX_BUNDLE, bundle.skills as string))).toEqual(tree(root.skills as string));
  });
});

describe("Cursor marketplace manifest at the repo root", () => {
  const market = json(CURSOR_MARKET);
  const entries = market.plugins as Json[];

  it("has the fields Cursor requires", () => {
    expect(market.name).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    expect((market.owner as Json).name).toBe("OrigoZero");
    expect(entries.map((entry) => entry.name)).toEqual(["zeromind"]);
  });

  it("lists plugin folders that hold a manifest of the same name", () => {
    for (const entry of entries) {
      const source = entry.source as string;
      expect(insideAndPresent(".", source), source).toBe(true);
      expect(json(join(source, ".cursor-plugin/plugin.json")).name).toBe(entry.name);
    }
  });

  it("lists a bundle whose skills, rules and MCP config Cursor can load", () => {
    expect(entries[0].source).toBe(CURSOR_BUNDLE);
    expect(tree(join(CURSOR_BUNDLE, "skills"))).toEqual(tree("skills"));
    for (const [file, body] of tree(join(CURSOR_BUNDLE, "skills"))) {
      const keys = frontmatter(body);
      expect(keys.name, `${file} frontmatter name`).toBeTruthy();
      expect(keys.description, `${file} frontmatter description`).toBeTruthy();
    }
    const rules = tree(join(CURSOR_BUNDLE, "rules"));
    expect(rules.size).toBeGreaterThan(0);
    for (const [file, body] of rules) {
      expect(frontmatter(body).description, `${file} frontmatter description`).toBeTruthy();
    }
    const servers = json(join(CURSOR_BUNDLE, "mcp.json")).mcpServers as Record<string, Json>;
    expect(servers.zeromind.url).toBe(MCP_URL);
  });
});
