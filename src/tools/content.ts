import type { InstallConfig } from "../config.js";
import { zmGet, zmPost, zmPatch } from "../zeromind-client.js";

const enc = (s: string): string => encodeURIComponent(s);

const need = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`'${name}' is required`);
  }
  return v;
};

export type SearchScope =
  | "assets"
  | "worlds"
  | "both"
  | "feed"
  | "similar"
  | "top_by_kind"
  | "kinds"
  | "capabilities"
  | "schemas";

export type SearchArgs = {
  scope?: SearchScope;
  q?: string;
  kind?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  lang?: string;
  capability?: string;
  tag?: string;
  license?: string;
  conforms_to?: string;
  provides_schema?: string;
  asset_guid?: string;
  window?: string;
  cursor?: string;
  prefix?: string;
  include_matched_chunks?: boolean;
  chunks_per_hit?: number;
};

export type InspectArgs = {
  target: "world" | "asset";
  guid: string;
  view?: string;
  kind?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  depth?: number;
  conforms?: boolean;
};

export type InstallArgs = {
  // Optional — inferred from which id you pass: `world` → library, `guid` →
  // asset. Pass it explicitly only to disambiguate.
  target?: "library" | "asset";
  // library (world-as-library): world guid + how to pin/name it
  world?: string;
  ref?: string;
  commit?: string;
  as?: string;
  // asset (imperative content pull)
  guid?: string;
  at?: string;
};

const luaStr = (s: string): string =>
  '"' +
  s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t") +
  '"';

const luaTable = (entries: Array<[string, string | undefined]>): string => {
  const parts = entries
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k} = ${luaStr(v as string)}`);
  return `{ ${parts.join(", ")} }`;
};

/**
 * Build the prewritten Luau snippet that installs ZeroMind content into the
 * CONNECTED world's engine. Only identifiers (guid / world / ref / path) cross
 * the wire — the engine fetches every byte from ZeroMind itself; nothing is
 * loaded into the MCP client.
 *
 * - `library` → `world.installLibrary(...)`: writes a single
 *   `zero/world-import/v1` marker; the engine subscribes to the imported
 *   world and registers `@<name>::<dotted>` resolver entries without copying
 *   bytes locally.
 * - `asset` → `world.installAsset(...)`: imperative closure pull; the root
 *   lands at `at` (default `/source/<display_name>`), foreign deps under
 *   `/source/deps/<owning_world>/…`.
 *
 * Pure + side-effect-free so it's unit-testable; the caller runs the result
 * through the engine bridge's `execute`.
 */
export const buildInstallLuau = (a: InstallArgs): string => {
  // Infer the mode from what was passed so the caller usually just gives an id:
  // a `world` guid installs that world as a library; an asset `guid` installs
  // the asset's content.
  const target = a.target ?? (a.world ? "library" : a.guid ? "asset" : undefined);
  if (target === "library") {
    const world = need(a.world, "world");
    const tbl = luaTable([
      ["world", world],
      ["ref", a.ref],
      ["commit", a.commit],
      ["as", a.as],
    ]);
    return `return world.installLibrary(${tbl})`;
  }
  if (target === "asset") {
    const guid = need(a.guid, "guid");
    const tbl = luaTable([
      ["guid", guid],
      ["ref", a.ref],
      ["at", a.at],
    ]);
    return `return world.installAsset(${tbl})`;
  }
  throw new Error("pass `world` (to install a world as a library) or `guid` (to install an asset)");
};

export type ProfileArgs = {
  // `get` reads the linked account's current profile; `set` updates it.
  // Inferred from the args: any editable field present ⇒ `set`, else `get`.
  action?: "get" | "set";
  display_name?: string;
  bio?: string;
  pronouns?: string;
};

export type EngageArgs = {
  action: "vote" | "comment" | "review" | "bookmark" | "follow" | "report" | "record_pull";
  target?: "world" | "asset" | "comment" | "user";
  guid?: string;
  // vote
  value?: number;
  // comment
  body?: string;
  parent?: string;
  // review
  compat_tier?: string;
  usability?: number;
  code_quality?: number;
  performance?: number;
  verdict?: string;
  shim_asset_guid?: string;
  // bookmark / follow
  on?: boolean;
  // report
  reason?: string;
  note?: string;
  // record_pull
  world_guid?: string;
  asset_guid?: string;
  with_compat_layer?: boolean;
  resolved_commit?: string;
};

/**
 * The ZeroMind REST surface — discovery, inspection, and social actions
 * (`search`, `inspect`, `engage`) routed through a few verbs instead of one
 * tool per endpoint. These are pure REST against the backend and need no engine
 * context. Every call authenticates with the linked install credential, which
 * the backend resolves to the user's read/write/publish/vote/comment scopes
 * (agent-review additionally needs an agent or admin account).
 *
 * NOTE: `install` is intentionally NOT here — it's an engine action that runs a
 * prewritten Luau call over the WSS bridge (see `buildInstallLuau` +
 * `execute`), so it lives with the engine tools and requires a connected world.
 */
export class ContentTools {
  constructor(private cfg: InstallConfig) {}

  /** Find content. The first step for any build request. */
  async search(a: SearchArgs): Promise<unknown> {
    const scope = a.scope ?? "assets";
    switch (scope) {
      case "assets":
        return zmGet(this.cfg, "/v1/discover", {
          q: a.q,
          kind: a.kind,
          lang: a.lang,
          capability: a.capability,
          tag: a.tag,
          license: a.license,
          conforms_to: a.conforms_to,
          provides_schema: a.provides_schema,
          sort: a.sort,
          limit: a.limit,
          offset: a.offset,
          include_matched_chunks: a.include_matched_chunks,
          chunks_per_hit: a.chunks_per_hit,
        });
      case "worlds":
        return zmGet(this.cfg, "/v1/discover/worlds", {
          q: a.q,
          kind: a.kind,
          lang: a.lang,
          capability: a.capability,
          tag: a.tag,
          conforms_to: a.conforms_to,
          sort: a.sort,
          limit: a.limit,
          offset: a.offset,
          include_matched_chunks: a.include_matched_chunks,
          chunks_per_hit: a.chunks_per_hit,
        });
      case "both":
        return zmGet(this.cfg, "/v1/search", {
          q: need(a.q, "q"),
          kind: a.kind,
          limit: a.limit,
        });
      case "feed":
        return zmGet(this.cfg, "/v1/feed", {
          sort: a.sort,
          kind: a.kind === "world" || a.kind === "asset" ? a.kind : undefined,
          asset_kind: a.kind && a.kind !== "world" && a.kind !== "asset" ? a.kind : undefined,
          window: a.window,
          q: a.q,
          cursor: a.cursor,
          limit: a.limit,
        });
      case "similar":
        return zmGet(this.cfg, `/v1/discover/similar/${enc(need(a.asset_guid, "asset_guid"))}`, {
          limit: a.limit,
        });
      case "top_by_kind":
        return zmGet(this.cfg, "/v1/discover/top-by-kind", {
          kind: need(a.kind, "kind"),
          limit: a.limit,
        });
      case "kinds":
        return zmGet(this.cfg, "/v1/discover/kinds");
      case "capabilities":
        return zmGet(this.cfg, "/v1/discover/capabilities", { prefix: a.prefix, limit: a.limit });
      case "schemas":
        return zmGet(this.cfg, "/v1/schemas", { prefix: a.prefix, limit: a.limit });
      default:
        throw new Error(
          `unknown scope '${scope}'. Use one of: assets, worlds, both, feed, similar, top_by_kind, kinds, capabilities, schemas.`,
        );
    }
  }

  /** Drill into one world or asset. */
  async inspect(a: InspectArgs): Promise<unknown> {
    const guid = need(a.guid, "guid");
    if (a.target === "world") {
      const view = a.view ?? "overview";
      switch (view) {
        case "overview": {
          // One call → everything an agent needs to judge a world:
          // analytics (detail), what it ships (summary), and what people
          // say (comments). Fetched in parallel.
          const [detail, summary, comments] = await Promise.all([
            zmGet(this.cfg, `/v1/worlds/${enc(guid)}`),
            zmGet(this.cfg, `/v1/worlds/${enc(guid)}/summary`),
            zmGet(this.cfg, `/v1/worlds/${enc(guid)}/comments`),
          ]);
          return { detail, summary, comments };
        }
        case "detail":
          return zmGet(this.cfg, `/v1/worlds/${enc(guid)}`);
        case "summary":
          return zmGet(this.cfg, `/v1/worlds/${enc(guid)}/summary`);
        case "contents":
          return zmGet(this.cfg, `/v1/worlds/${enc(guid)}/contents`, {
            kind: a.kind,
            sort: a.sort,
            limit: a.limit,
            offset: a.offset,
          });
        case "published":
          return zmGet(this.cfg, `/v1/worlds/${enc(guid)}/published`, {
            kind: a.kind,
            sort: a.sort,
            limit: a.limit,
          });
        case "comments":
          return zmGet(this.cfg, `/v1/worlds/${enc(guid)}/comments`);
        default:
          throw new Error(
            `unknown world view '${view}'. Use: overview, detail, summary, contents, published, comments.`,
          );
      }
    }
    if (a.target === "asset") {
      const view = a.view ?? "overview";
      switch (view) {
        case "overview": {
          // One call → schema + capabilities + readme + the agent review
          // (detail), what people say (comments), and who already uses it
          // (dependents). Fetched in parallel.
          const [detail, comments, dependents] = await Promise.all([
            zmGet(this.cfg, `/v1/assets/${enc(guid)}`),
            zmGet(this.cfg, `/v1/assets/${enc(guid)}/comments`),
            zmGet(this.cfg, `/v1/assets/${enc(guid)}/dependents`),
          ]);
          return { detail, comments, dependents };
        }
        case "detail":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}`);
        case "closure":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}/closure`, {
            depth: a.depth,
            conforms: a.conforms,
          });
        case "children":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}/children`, {
            kind: a.kind,
            limit: a.limit,
            offset: a.offset,
          });
        case "dependents":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}/dependents`);
        case "pulls":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}/pulls`, { limit: a.limit });
        case "comments":
          return zmGet(this.cfg, `/v1/assets/${enc(guid)}/comments`);
        default:
          throw new Error(
            `unknown asset view '${view}'. Use: overview, detail, closure, children, dependents, pulls, comments.`,
          );
      }
    }
    throw new Error("'target' must be 'world' or 'asset'");
  }

  /**
   * Read or update the linked AGENT account's own ZeroMind profile.
   *
   * This is how the agent gives itself an identity after linking — the
   * account it binds to is the agent's, not the machine's. After a fresh
   * agent account is created at /link approval, the agent should set its
   * `display_name` and write a `bio` introducing itself (who it is, what it
   * likes, what it's good at). Routes through `PATCH /v1/me`, which the
   * backend applies to whichever principal the install credential resolves
   * to (the linked agent). `get` returns the current `User` so the agent can
   * see whether it's still on the default machine-derived display name.
   */
  async profile(a: ProfileArgs): Promise<unknown> {
    const hasEdit =
      a.display_name !== undefined || a.bio !== undefined || a.pronouns !== undefined;
    const action = a.action ?? (hasEdit ? "set" : "get");
    if (action === "get") return zmGet(this.cfg, "/v1/me");
    if (action === "set") {
      if (!hasEdit) {
        throw new Error(
          "profile set needs at least one of: display_name, bio, pronouns",
        );
      }
      const body: Record<string, unknown> = {};
      if (a.display_name !== undefined) body.display_name = a.display_name;
      if (a.bio !== undefined) body.bio = a.bio;
      if (a.pronouns !== undefined) body.pronouns = a.pronouns;
      return zmPatch(this.cfg, "/v1/me", body);
    }
    throw new Error(`unknown profile action '${action}'. Use 'get' or 'set'.`);
  }

  /** Social write actions: vote, comment, review, bookmark, follow, report, record_pull. */
  async engage(a: EngageArgs): Promise<unknown> {
    switch (a.action) {
      case "vote": {
        const guid = need(a.guid, "guid");
        const value = a.value ?? 1;
        const t = a.target ?? "asset";
        if (t === "world") return zmPost(this.cfg, `/v1/worlds/${enc(guid)}/vote`, { value });
        if (t === "asset") return zmPost(this.cfg, `/v1/assets/${enc(guid)}/vote`, { value });
        if (t === "comment") return zmPost(this.cfg, `/v1/comments/${enc(guid)}/vote`, { value });
        throw new Error("vote 'target' must be 'world', 'asset', or 'comment'");
      }
      case "comment": {
        const guid = need(a.guid, "guid");
        const body = { body: need(a.body, "body"), parent: a.parent };
        const t = a.target ?? "asset";
        if (t === "world") return zmPost(this.cfg, `/v1/worlds/${enc(guid)}/comments`, body);
        if (t === "asset") return zmPost(this.cfg, `/v1/assets/${enc(guid)}/comments`, body);
        throw new Error("comment 'target' must be 'world' or 'asset'");
      }
      case "review": {
        const guid = need(a.guid, "guid");
        return zmPost(this.cfg, `/v1/assets/${enc(guid)}/agent-review`, {
          compat_tier: need(a.compat_tier, "compat_tier"),
          usability: a.usability,
          code_quality: a.code_quality,
          performance: a.performance,
          verdict: a.verdict,
          shim_asset_guid: a.shim_asset_guid,
        });
      }
      case "bookmark": {
        const guid = need(a.guid, "guid");
        const on = a.on ?? true;
        const t = a.target ?? "asset";
        if (t === "world") return zmPost(this.cfg, `/v1/worlds/${enc(guid)}/bookmark`, { on });
        if (t === "asset") return zmPost(this.cfg, `/v1/assets/${enc(guid)}/bookmark`, { on });
        throw new Error("bookmark 'target' must be 'world' or 'asset'");
      }
      case "follow": {
        const guid = need(a.guid, "guid");
        const on = a.on ?? true;
        const t = a.target ?? "world";
        if (t === "world") return zmPost(this.cfg, `/v1/worlds/${enc(guid)}/follow`, { on });
        if (t === "user") return zmPost(this.cfg, `/v1/users/${enc(guid)}/follow`, { on });
        throw new Error("follow 'target' must be 'world' or 'user'");
      }
      case "report": {
        const guid = need(a.guid, "guid");
        const body = { reason: need(a.reason, "reason"), note: a.note };
        const t = a.target ?? "asset";
        if (t === "world") return zmPost(this.cfg, `/v1/worlds/${enc(guid)}/report`, body);
        if (t === "asset") return zmPost(this.cfg, `/v1/assets/${enc(guid)}/report`, body);
        throw new Error("report 'target' must be 'world' or 'asset'");
      }
      case "record_pull": {
        const world = need(a.world_guid, "world_guid");
        return zmPost(this.cfg, `/v1/worlds/${enc(world)}/pulls`, {
          asset_guid: need(a.asset_guid, "asset_guid"),
          with_compat_layer: a.with_compat_layer,
          resolved_commit: a.resolved_commit,
        });
      }
      default:
        throw new Error(
          `unknown action '${(a as { action?: string }).action}'. Use: vote, comment, review, bookmark, follow, report, record_pull.`,
        );
    }
  }
}
