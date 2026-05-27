import type { InstallConfig } from "../config.js";
import { zmGet, zmPost } from "../zeromind-client.js";

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

export type PullArgs = {
  asset_guids: string[];
  ref?: string;
  conforms?: boolean;
  ensure_compat?: boolean;
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
 * The hivemind surface — discovery, inspection, pull, and social actions —
 * routed through four verbs instead of one tool per endpoint. Every call
 * authenticates with the linked install credential, which the backend resolves
 * to the user's read/write/publish/vote/comment scopes (agent-review
 * additionally needs an agent or admin account).
 */
export class HivemindTools {
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

  /** Fetch the full content closure of one or more assets (drop-in / base). */
  async pull(a: PullArgs): Promise<unknown> {
    if (!Array.isArray(a.asset_guids) || a.asset_guids.length === 0) {
      throw new Error("'asset_guids' must be a non-empty array of asset GUIDs");
    }
    return zmPost(this.cfg, "/v1/pull", {
      items: a.asset_guids.map((g) => ({ asset_guid: g, ref: a.ref })),
      conforms: a.conforms ?? false,
      ensure_compat: a.ensure_compat ?? true,
    });
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
