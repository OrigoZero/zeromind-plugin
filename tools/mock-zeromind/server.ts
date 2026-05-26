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

      return text(res, 404, "Not found");
    } catch (e) {
      return json(res, 500, { error: "internal", detail: String(e) });
    }
  });
