import { spawn } from "node:child_process";
import type { InstallConfig } from "../config.js";
import type { Bridge } from "../bridge.js";
import type { World, SessionOpened, SessionClosed } from "../types.js";
import { listWorlds, createWorld, issuer } from "../zeromind-client.js";

export type ConnectResult =
  | { ok: true; session_id: string }
  | { ok: false; error: "no_active_session"; url: string; message: string }
  | { ok: false; error: "launch_failed"; url: string; message: string };

export type LaunchResult =
  | { ok: true; url: string; opened_with: string }
  | { ok: false; url: string; message: string };

const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
const SESSION_OPEN_GRACE_MS = 250;

export class WorldTools {
  private activeSessions = new Map<string, string>();
  private current?: string;
  private waiters = new Map<string, Array<(session_id: string) => void>>();

  constructor(
    private cfg: InstallConfig,
    private bridge: Bridge,
  ) {
    bridge.on("session.opened", (e: SessionOpened) => {
      this.activeSessions.set(e.world_guid, e.session_id);
      const queue = this.waiters.get(e.world_guid);
      if (queue) {
        this.waiters.delete(e.world_guid);
        for (const resolve of queue) resolve(e.session_id);
      }
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

  /** URL the user (or `world.launch`) opens in the browser to start a session. */
  playUrl(guid: string): string {
    return `${issuer().replace(/\/+$/, "")}/edit/${guid}`;
  }

  openInBrowser(guid: string): { url: string; message: string } {
    const url = this.playUrl(guid);
    return {
      url,
      message: `Open this URL in a browser tab to start the world, then I'll continue: ${url}`,
    };
  }

  /**
   * Open the world's play URL in the user's default browser. Spawns the
   * platform's open command (`start` / `open` / `xdg-open`) and returns
   * immediately — the actual browser-engine boot happens asynchronously,
   * which `world.connect` then long-polls for.
   */
  launch(params: { guid: string }): LaunchResult {
    const url = this.playUrl(params.guid);
    const platform = process.platform;
    let command: string;
    let args: string[];
    if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else if (platform === "darwin") {
      command = "open";
      args = [url];
    } else {
      command = "xdg-open";
      args = [url];
    }
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, url, opened_with: command };
    } catch (e) {
      return {
        ok: false,
        url,
        message: `Couldn't spawn '${command}': ${(e as Error).message}. Open the URL manually: ${url}`,
      };
    }
  }

  /**
   * Attach to an active browser session for a world. If no session is
   * active yet, long-polls up to `timeout_ms` (default 60s) for a
   * `session.opened` event from the bridge — typically what happens
   * after `world.launch` opens the browser tab and the WASM engine
   * finishes booting.
   *
   * Pass `auto_launch: true` to automatically `world.launch` the play
   * URL before polling, so a single tool call covers the entire
   * "open + wait + attach" handshake.
   */
  async connect(params: {
    guid: string;
    timeout_ms?: number;
    auto_launch?: boolean;
  }): Promise<ConnectResult> {
    const existing = this.activeSessions.get(params.guid);
    if (existing) {
      this.current = existing;
      return { ok: true, session_id: existing };
    }

    if (params.auto_launch) {
      const launchResult = this.launch({ guid: params.guid });
      if (!launchResult.ok) {
        return {
          ok: false,
          error: "launch_failed",
          url: launchResult.url,
          message: launchResult.message,
        };
      }
    }

    const timeoutMs = params.timeout_ms ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const sessionId = await this.waitForSession(params.guid, timeoutMs);
    if (sessionId) {
      // Small grace period — let the engine finish its trusted-VM
      // bootstrap before the AI starts hitting it with execute()s.
      await new Promise((r) => setTimeout(r, SESSION_OPEN_GRACE_MS));
      this.current = sessionId;
      return { ok: true, session_id: sessionId };
    }

    const url = this.playUrl(params.guid);
    return {
      ok: false,
      error: "no_active_session",
      url,
      message:
        `Waited ${timeoutMs}ms but no browser session opened for this world. ` +
        `Ask the user to open ${url} in their browser (or pass auto_launch: true ` +
        `to have me open it).`,
    };
  }

  disconnect(): { ok: true } {
    this.current = undefined;
    return { ok: true };
  }

  currentSession(): string | undefined {
    return this.current;
  }

  private waitForSession(guid: string, timeoutMs: number): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      let settled = false;
      const finish = (session_id: string | undefined) => {
        if (settled) return;
        settled = true;
        const queue = this.waiters.get(guid);
        if (queue) {
          const idx = queue.indexOf(notify);
          if (idx >= 0) queue.splice(idx, 1);
          if (queue.length === 0) this.waiters.delete(guid);
        }
        resolve(session_id);
      };
      const notify = (session_id: string) => finish(session_id);
      const existing = this.activeSessions.get(guid);
      if (existing) {
        finish(existing);
        return;
      }
      const queue = this.waiters.get(guid) ?? [];
      queue.push(notify);
      this.waiters.set(guid, queue);
      setTimeout(() => finish(undefined), timeoutMs);
    });
  }
}
