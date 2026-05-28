import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Config-format-aware editors for each harness's native config file.
 *
 * Each editor reads the file (creating an empty default if missing),
 * applies an idempotent edit that ADDS the ZeroMind entry without
 * touching the user's other entries, and writes it back. Re-running an
 * install upgrades the ZeroMind entry in place; user content is preserved.
 */

const ensureDir = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
};

const readOr = (path: string, fallback: string): string =>
  existsSync(path) ? readFileSync(path, "utf8") : fallback;

// ─── JSON ────────────────────────────────────────────────────────────────

export type JsonObject = Record<string, unknown>;

/** Set a single-key entry inside a top-level object key (e.g.
 *  `mcpServers.zeromind = {...}`). Creates the parent key if missing. */
export const editJsonEntry = (
  path: string,
  parentKey: string,
  entryKey: string,
  entry: unknown,
): "written" | "updated" => {
  ensureDir(path);
  const existed = existsSync(path);
  let obj: JsonObject = {};
  if (existed) {
    const raw = readFileSync(path, "utf8").trim();
    if (raw) obj = JSON.parse(raw) as JsonObject;
  }
  const parent = (obj[parentKey] as JsonObject | undefined) ?? {};
  const isUpdate = entryKey in parent;
  parent[entryKey] = entry;
  obj[parentKey] = parent;
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
  return existed && isUpdate ? "updated" : "written";
};

// ─── JSONC (Zed settings, OpenCode opencode.jsonc, VS Code settings) ────

/** Edit a JSONC file preserving comments and most formatting. */
export const editJsoncEntry = async (
  path: string,
  parentPath: string[],
  entryKey: string,
  entry: unknown,
): Promise<"written" | "updated"> => {
  const { applyEdits, modify, parse } = await import("jsonc-parser");
  ensureDir(path);
  const existed = existsSync(path);
  const text = existed ? readFileSync(path, "utf8") : "{}\n";
  const parsed = (parse(text) as JsonObject | undefined) ?? {};
  let cursor: JsonObject = parsed;
  for (const k of parentPath) {
    cursor = (cursor[k] as JsonObject | undefined) ?? {};
  }
  const isUpdate = entryKey in cursor;
  const edits = modify(text, [...parentPath, entryKey], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  const out = applyEdits(text, edits);
  writeFileSync(path, out.endsWith("\n") ? out : out + "\n");
  return existed && isUpdate ? "updated" : "written";
};

// ─── TOML (Codex ~/.codex/config.toml) ──────────────────────────────────

/** Set a nested TOML table value preserving other tables. Uses a
 *  delimited block at the end of the file to make round-trips clean. */
const TOML_BEGIN = "# >>> zeromind >>>";
const TOML_END = "# <<< zeromind <<<";

export const upsertTomlBlock = (
  path: string,
  blockBody: string,
): "written" | "updated" => {
  ensureDir(path);
  const existed = existsSync(path);
  const existing = readOr(path, "");
  const block = `${TOML_BEGIN}\n${blockBody.trim()}\n${TOML_END}\n`;
  const beginIdx = existing.indexOf(TOML_BEGIN);
  const endIdx = existing.indexOf(TOML_END);
  let next: string;
  if (beginIdx !== -1 && endIdx !== -1) {
    next =
      existing.slice(0, beginIdx) +
      block +
      existing.slice(endIdx + TOML_END.length).replace(/^\n/, "");
  } else {
    const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
    next = existing + sep + block;
  }
  writeFileSync(path, next);
  return existed && beginIdx !== -1 ? "updated" : "written";
};

// ─── YAML (Continue ~/.continue/config.yaml, .aider.conf.yml) ──────────

/** Merge a single entry by `name` into a YAML list at a top-level key.
 *  Replaces an existing entry with the same name, otherwise appends. */
export const upsertYamlListEntry = async (
  path: string,
  listKey: string,
  entry: { name: string } & Record<string, unknown>,
): Promise<"written" | "updated"> => {
  const YAML = await import("yaml");
  ensureDir(path);
  const existed = existsSync(path);
  const text = existed ? readFileSync(path, "utf8") : "";
  const doc = text.trim()
    ? (YAML.parse(text) as Record<string, unknown>)
    : {};
  const list = ((doc[listKey] as Array<{ name?: string }> | undefined) ?? []).slice();
  const idx = list.findIndex((e) => e?.name === entry.name);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  doc[listKey] = list;
  writeFileSync(path, YAML.stringify(doc));
  return existed && idx >= 0 ? "updated" : "written";
};

/** Append a unique string value to a YAML list at a top-level key
 *  (used for Aider's `read: [...]`). */
export const upsertYamlListString = async (
  path: string,
  listKey: string,
  value: string,
): Promise<"written" | "updated"> => {
  const YAML = await import("yaml");
  ensureDir(path);
  const existed = existsSync(path);
  const text = existed ? readFileSync(path, "utf8") : "";
  const doc = text.trim()
    ? (YAML.parse(text) as Record<string, unknown>)
    : {};
  const list = ((doc[listKey] as string[] | undefined) ?? []).slice();
  const present = list.includes(value);
  if (!present) list.push(value);
  doc[listKey] = list;
  writeFileSync(path, YAML.stringify(doc));
  return existed && present ? "updated" : "written";
};

// ─── Plain block in markdown / hints files ─────────────────────────────

export const BLOCK_BEGIN = "<!-- BEGIN ZEROMIND -->";
export const BLOCK_END = "<!-- END ZEROMIND -->";

export const upsertMarkdownBlock = (
  path: string,
  blockBody: string,
): "written" | "updated" => {
  ensureDir(path);
  const existed = existsSync(path);
  const existing = readOr(path, "");
  const block = `${BLOCK_BEGIN}\n\n${blockBody.trim()}\n\n${BLOCK_END}\n`;
  const beginIdx = existing.indexOf(BLOCK_BEGIN);
  const endIdx = existing.indexOf(BLOCK_END);
  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    next =
      existing.slice(0, beginIdx) +
      block.trimEnd() +
      existing.slice(endIdx + BLOCK_END.length);
    next = next.replace(/\n{3,}/g, "\n\n");
    if (!next.endsWith("\n")) next += "\n";
  } else {
    const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
    next = existing + sep + block;
  }
  writeFileSync(path, next);
  return existed && beginIdx !== -1 ? "updated" : "written";
};

// ─── Owned file (skill, rule files) ─────────────────────────────────────

export const writeOwnedFile = (
  path: string,
  content: string,
  force: boolean,
): "written" | "exists" => {
  if (existsSync(path) && !force) return "exists";
  ensureDir(path);
  writeFileSync(path, content);
  return "written";
};
