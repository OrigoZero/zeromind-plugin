import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "node:url";
import type { MockState } from "./server.js";

type IdeConn = { ws: WebSocket; userId: string; installId: string };
type BrowserConn = {
  ws: WebSocket;
  userId: string;
  worldGuid: string;
  sessionId: string;
};

export const setupBridge = (server: Server, state: MockState): void => {
  const wss = new WebSocketServer({ noServer: true });
  const ides = new Map<string, IdeConn>();
  const browsers = new Map<string, BrowserConn>();
  const pending = new Map<string, string>();

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/v1/bridge")) {
      socket.destroy();
      return;
    }
    const u = new URL(req.url, "http://localhost");
    const role = u.searchParams.get("role");
    const authHeader = (req.headers.authorization ?? "") as string;

    if (role === "ide") {
      const secret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const install = state.bySecret(secret);
      if (!install || !install.linked) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4401, "unauthorized"));
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: IdeConn = {
          ws,
          installId: install.install_id,
          userId: install.user_id!,
        };
        ides.set(install.install_id, conn);
        ws.on("message", (raw) => handleIde(conn, raw.toString(), browsers, pending));
        ws.on("close", () => ides.delete(install.install_id));
      });
      return;
    }

    if (role === "browser") {
      const worldGuid = u.searchParams.get("world_guid") ?? "";
      const sessionId = u.searchParams.get("session_id") ?? "";
      const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const m = jwt.match(/^mock-user-jwt-(.+)$/);
      if (!m || !worldGuid || !sessionId) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4401, "unauthorized"));
        return;
      }
      const userId = m[1];
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: BrowserConn = { ws, userId, worldGuid, sessionId };
        browsers.set(sessionId, conn);
        let set = state.sessionsByWorld.get(worldGuid);
        if (!set) {
          set = new Set();
          state.sessionsByWorld.set(worldGuid, set);
        }
        set.add(sessionId);

        for (const ide of ides.values()) {
          if (ide.userId === userId) {
            ide.ws.send(
              JSON.stringify({
                type: "session.opened",
                world_guid: worldGuid,
                session_id: sessionId,
                user_id: userId,
              }),
            );
          }
        }

        ws.on("message", (raw) => handleBrowser(raw.toString(), ides, pending));
        ws.on("close", () => {
          browsers.delete(sessionId);
          state.sessionsByWorld.get(worldGuid)?.delete(sessionId);
          for (const ide of ides.values()) {
            if (ide.userId === userId) {
              ide.ws.send(
                JSON.stringify({
                  type: "session.closed",
                  session_id: sessionId,
                  reason: "disconnect",
                }),
              );
            }
          }
        });
      });
      return;
    }

    socket.destroy();
  });
};

const handleIde = (
  conn: IdeConn,
  raw: string,
  browsers: Map<string, BrowserConn>,
  pending: Map<string, string>,
): void => {
  let frame: {
    type?: string;
    id?: string;
    target_session?: string;
    method?: string;
    params?: unknown;
  };
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }
  if (frame.type !== "rpc.call" || !frame.id || !frame.target_session) return;
  const browser = browsers.get(frame.target_session);
  if (!browser || browser.userId !== conn.userId) {
    conn.ws.send(
      JSON.stringify({
        type: "rpc.error",
        id: frame.id,
        code: "forbidden",
        message: "session not connected or not owned by your user",
      }),
    );
    return;
  }
  pending.set(frame.id, conn.installId);
  browser.ws.send(
    JSON.stringify({
      type: "rpc.call",
      id: frame.id,
      method: frame.method,
      params: frame.params,
    }),
  );
};

const handleBrowser = (
  raw: string,
  ides: Map<string, IdeConn>,
  pending: Map<string, string>,
): void => {
  let frame: { type?: string; id?: string };
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }
  if (frame.type !== "rpc.response" && frame.type !== "rpc.error") return;
  if (!frame.id) return;
  const installId = pending.get(frame.id);
  if (!installId) return;
  pending.delete(frame.id);
  const ide = ides.get(installId);
  if (!ide) return;
  ide.ws.send(raw);
};
