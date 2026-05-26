import type { InstallConfig } from "../config.js";
import type { Bridge } from "../bridge.js";
import type { World, SessionOpened, SessionClosed } from "../types.js";
import { listWorlds, createWorld, issuer } from "../zeromind-client.js";

export type ConnectResult =
  | { ok: true; session_id: string }
  | { ok: false; error: "no_active_session"; url: string; message: string };

export class WorldTools {
  private activeSessions = new Map<string, string>(); // world_guid → session_id
  private current?: string; // session_id

  constructor(
    private cfg: InstallConfig,
    private bridge: Bridge,
  ) {
    bridge.on("session.opened", (e: SessionOpened) => {
      this.activeSessions.set(e.world_guid, e.session_id);
    });
    bridge.on("session.closed", (e: SessionClosed) => {
      if (this.current === e.session_id) this.current = undefined;
      for (const [g, s] of this.activeSessions) {
        if (s === e.session_id) this.activeSessions.delete(g);
      }
    });
  }

  async list(): Promise<World[]> {
    return listWorlds(this.cfg);
  }

  async create(params: {
    name: string;
    template?: string;
    public?: boolean;
  }): Promise<World> {
    return createWorld(this.cfg, params);
  }

  openInBrowser(guid: string): { url: string; message: string } {
    const url = `${issuer().replace(/\/+$/, "")}/play/${guid}`;
    return {
      url,
      message: `Open this URL in a browser tab to start the world, then I'll continue: ${url}`,
    };
  }

  async connect(params: { guid: string }): Promise<ConnectResult> {
    const existing = this.activeSessions.get(params.guid);
    if (existing) {
      this.current = existing;
      return { ok: true, session_id: existing };
    }
    const help = this.openInBrowser(params.guid);
    return { ok: false, error: "no_active_session", ...help };
  }

  disconnect(): { ok: true } {
    this.current = undefined;
    return { ok: true };
  }

  currentSession(): string | undefined {
    return this.current;
  }
}
