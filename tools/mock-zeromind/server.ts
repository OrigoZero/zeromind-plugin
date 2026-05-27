import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

export type InstallRow = {
  install_id: string;
  install_secret: string;
  install_name: string;
  public_key: string;
  linked: boolean;
  user_id?: string;
  pending_code?: { user_code: string; expires_at: number };
};

export type WorldRow = {
  guid: string;
  name: string;
  is_public: boolean;
  owner_user_id: string;
  created_by_install_id: string;
};

export class MockState {
  installs = new Map<string, InstallRow>();
  worlds = new Map<string, WorldRow>();
  sessionsByWorld = new Map<string, Set<string>>();

  bySecret(secret: string): InstallRow | undefined {
    for (const row of this.installs.values()) {
      if (row.install_secret === secret) return row;
    }
    return undefined;
  }

  byUserCode(code: string): InstallRow | undefined {
    for (const row of this.installs.values()) {
      if (row.pending_code?.user_code === code) return row;
    }
    return undefined;
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const text = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(body);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
};

const requireAuth = (req: IncomingMessage, state: MockState): InstallRow | null => {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return state.bySecret(h.slice(7)) ?? null;
};

export const buildServer = (state: MockState): Server =>
  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "POST" && path === "/v1/installs/register") {
        const body = (await readJson(req)) as { install_name?: string; public_key?: string };
        if (!body.install_name || !body.public_key) {
          return json(res, 400, { error: "missing_fields" });
        }
        const id = `inst_${randomBytes(8).toString("hex")}`;
        const secret = `ins_sec_${randomBytes(16).toString("hex")}`;
        state.installs.set(id, {
          install_id: id,
          install_secret: secret,
          install_name: body.install_name,
          public_key: body.public_key,
          linked: false,
        });
        return json(res, 200, { install_id: id, install_secret: secret });
      }

      const linkCodesMatch = path.match(/^\/v1\/installs\/([^/]+)\/link-codes$/);
      if (method === "POST" && linkCodesMatch) {
        const install = requireAuth(req, state);
        if (!install || install.install_id !== linkCodesMatch[1]) {
          return json(res, 401, { error: "unauthorized" });
        }
        const userCode =
          randomBytes(2).toString("hex").toUpperCase() +
          "-" +
          randomBytes(2).toString("hex").toUpperCase();
        install.pending_code = { user_code: userCode, expires_at: Date.now() + 600_000 };
        return json(res, 200, {
          user_code: userCode,
          verification_url: "http://localhost/link",
          expires_in: 600,
          interval: 5,
        });
      }

      const linkStatusMatch = path.match(/^\/v1\/installs\/([^/]+)\/link-status$/);
      if (method === "GET" && linkStatusMatch) {
        const install = requireAuth(req, state);
        if (!install || install.install_id !== linkStatusMatch[1]) {
          return json(res, 401, { error: "unauthorized" });
        }
        if (install.linked) {
          return json(res, 200, { status: "approved", user_id: install.user_id });
        }
        return json(res, 200, { status: "pending" });
      }

      const unlinkMatch = path.match(/^\/v1\/installs\/([^/]+)\/unlink$/);
      if (method === "POST" && unlinkMatch) {
        const install = requireAuth(req, state);
        if (!install || install.install_id !== unlinkMatch[1]) {
          return json(res, 401, { error: "unauthorized" });
        }
        install.linked = false;
        install.user_id = undefined;
        install.pending_code = undefined;
        return json(res, 200, { ok: true });
      }

      if (method === "GET" && path === "/v1/me/worlds") {
        const install = requireAuth(req, state);
        if (!install || !install.linked) {
          return json(res, 401, { error: "unauthorized" });
        }
        const worlds = [...state.worlds.values()].filter(
          (w) => w.owner_user_id === install.user_id,
        );
        return json(res, 200, { worlds });
      }

      if (method === "POST" && path === "/v1/worlds") {
        const install = requireAuth(req, state);
        if (!install || !install.linked) {
          return json(res, 401, { error: "unauthorized" });
        }
        const body = (await readJson(req)) as {
          name?: string;
          template?: string;
          public?: boolean;
        };
        if (!body.name) return json(res, 400, { error: "missing_name" });
        const guid = `wld_${randomBytes(8).toString("hex")}`;
        const world: WorldRow = {
          guid,
          name: body.name,
          is_public: !!body.public,
          owner_user_id: install.user_id!,
          created_by_install_id: install.install_id,
        };
        state.worlds.set(guid, world);
        return json(res, 200, { world });
      }

      // ── ZeroMind: discovery (GET) ──────────────────────────────────────
      if (method === "GET" && path === "/v1/discover") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, {
          hits: [
            {
              asset_guid: "ast_mock1",
              owning_world: "wld_mock1",
              kind: url.searchParams.get("kind") ?? "module",
              display_name: "mock-module",
              import_hint: "@wld_mock1@cmt_mock/mock-module",
              compat_tier: "compatible",
            },
          ],
          total: 1,
          limit: Number(url.searchParams.get("limit") ?? 25),
          offset: Number(url.searchParams.get("offset") ?? 0),
          query_echo: { q: url.searchParams.get("q"), kind: url.searchParams.get("kind") },
        });
      }
      if (method === "GET" && path === "/v1/discover/worlds") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { worlds: [{ world_guid: "wld_mock1", world_title: "Mock" }] });
      }
      if (method === "GET" && path === "/v1/search") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { worlds: [], assets: [], q: url.searchParams.get("q") });
      }
      if (method === "GET" && path === "/v1/feed") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { items: [], next_cursor: null, sort: url.searchParams.get("sort") });
      }
      const similarMatch = path.match(/^\/v1\/discover\/similar\/([^/]+)$/);
      if (method === "GET" && similarMatch) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { hits: [], query_echo: { seed_asset: similarMatch[1] } });
      }
      if (method === "GET" && path === "/v1/discover/top-by-kind") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { kind: url.searchParams.get("kind"), assets: [] });
      }
      if (method === "GET" && path === "/v1/discover/kinds") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { kinds: [{ kind: "module", count: 1, is_composite: true }] });
      }
      if (method === "GET" && path === "/v1/discover/capabilities") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { capabilities: [] });
      }
      if (method === "GET" && path === "/v1/schemas") {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { schemas: [] });
      }

      // ── ZeroMind: inspect (GET worlds/assets sub-resources) ────────────
      const worldSub = path.match(/^\/v1\/worlds\/([^/]+)\/(summary|contents|published|comments)$/);
      if (method === "GET" && worldSub) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        const [, guid, view] = worldSub;
        if (view === "comments") return json(res, 200, []);
        return json(res, 200, { world: guid, view });
      }
      const worldDetail = path.match(/^\/v1\/worlds\/([^/]+)$/);
      if (method === "GET" && worldDetail) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { guid: worldDetail[1], title: "Mock World" });
      }
      const assetSub = path.match(/^\/v1\/assets\/([^/]+)\/(closure|children|dependents|pulls|comments)$/);
      if (method === "GET" && assetSub) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        const [, guid, view] = assetSub;
        if (view === "comments") return json(res, 200, []);
        if (view === "closure") {
          return json(res, 200, { roots: [guid], assets: [], blobs: [], truncated: false });
        }
        if (view === "dependents") {
          return json(res, 200, { asset_guid: guid, pulled_by: [], required_by: [], conformed_by: [] });
        }
        return json(res, 200, { asset_guid: guid, view });
      }
      const assetDetail = path.match(/^\/v1\/assets\/([^/]+)$/);
      if (method === "GET" && assetDetail) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, {
          asset_guid: assetDetail[1],
          owning_world: "wld_mock1",
          kind: "module",
          display_name: "mock-module",
          capabilities: ["mock_capability"],
          readme_excerpt: "Mock readme.",
          score: 0,
          comment_count: 0,
          view_count: 0,
          pulled_into_count: 0,
        });
      }

      // ── ZeroMind: engage (POST social) ─────────────────────────────────
      const voteMatch = path.match(/^\/v1\/(worlds|assets)\/([^/]+)\/vote$/);
      if (method === "POST" && voteMatch) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        res.writeHead(204);
        return res.end();
      }
      const commentVote = path.match(/^\/v1\/comments\/([^/]+)\/vote$/);
      if (method === "POST" && commentVote) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        return json(res, 200, { score: 1 });
      }
      const addComment = path.match(/^\/v1\/(worlds|assets)\/([^/]+)\/comments$/);
      if (method === "POST" && addComment) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        const body = (await readJson(req)) as { body?: string; parent?: string };
        return json(res, 200, {
          comment_id: "cmt_mock",
          body: body.body,
          parent: body.parent ?? null,
        });
      }
      const reviewMatch = path.match(/^\/v1\/assets\/([^/]+)\/agent-review$/);
      if (method === "POST" && reviewMatch) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        const body = (await readJson(req)) as Record<string, unknown>;
        return json(res, 200, { asset_guid: reviewMatch[1], agent_score: 86, ...body });
      }
      const toggleMatch = path.match(/^\/v1\/(worlds|assets|users)\/([^/]+)\/(bookmark|follow|report)$/);
      if (method === "POST" && toggleMatch) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        res.writeHead(204);
        return res.end();
      }
      const recordPull = path.match(/^\/v1\/worlds\/([^/]+)\/pulls$/);
      if (method === "POST" && recordPull) {
        if (!requireAuth(req, state)) return json(res, 401, { error: "unauthorized" });
        const body = (await readJson(req)) as { asset_guid?: string };
        return json(res, 200, {
          world_guid: recordPull[1],
          asset_guid: body.asset_guid,
          created: true,
        });
      }

      return text(res, 404, "Not found");
    } catch (e) {
      return json(res, 500, { error: "internal", detail: String(e) });
    }
  });
