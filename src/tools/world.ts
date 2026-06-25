import { spawn } from "node:child_process";
import type { InstallConfig } from "../config.js";
import type { Bridge } from "../bridge.js";
import type { World, SessionOpened, SessionClosed } from "../types.js";
import {
  listWorlds,
  createWorld,
  forkWorld,
  deleteWorld,
  restoreWorld,
  listTrash,
  issuer,
  type TrashedWorld,
} from "../zeromind-client.js";

export type ConnectResult =
  | { ok: true; session_id: string }
  | { ok: false; error: "no_active_session"; url: string; message: string }
  | { ok: false; error: "launch_failed"; url: string; message: string };

export type LaunchResult =
  | { ok: true; url: string; opened_with: string }
  | { ok: false; url: string; message: string };

const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
const SESSION_OPEN_GRACE_MS = 250;

/** Whole days until a trashed world is permanently purged (clamped ≥ 0).
 *  Uses `floor` to match the web Trash tab's truncating `num_days()`, so the
 *  agent and the website never report a different countdown for one world. */
const purgesInDays = (deletedAt: string | undefined, retentionDays: number): number | undefined => {
  if (!deletedAt) return undefined;
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * 86_400_000;
  return Math.max(0, Math.floor((purgeAt - Date.now()) / 86_400_000));
};

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

  /**
   * Fork an existing world into the caller's namespace. The source is
   * typically a `world_guid` from `zeromind.search { scope: 'worlds' }`
   * (a foreign public world); a bare name resolves only against your own
   * worlds. The fork inherits the source's visibility (GitHub-style).
   */
  async fork(params: {
    source?: string;
    world?: string;
    guid?: string;
    name_or_guid?: string;
    name?: string;
  }): Promise<
    | { world_guid: string; bootstrapped: boolean; source_guid: string; message: string }
    | { error: string }
  > {
    const candidate = params.source ?? params.world;
    const r = await this.resolveGuid({
      guid: params.guid,
      name_or_guid: params.name_or_guid ?? candidate,
    });
    if (r.error) return { error: r.error };
    const srcGuid = r.guid!;
    const forked = await forkWorld(this.cfg, srcGuid, { name: params.name });
    return {
      world_guid: forked.world_guid,
      bootstrapped: forked.bootstrapped,
      source_guid: srcGuid,
      message:
        `Forked into your namespace as ${forked.world_guid}. ` +
        `Connect with world.connect { guid: "${forked.world_guid}", auto_launch: true }.`,
    };
  }

  /**
   * Soft-delete (trash) a world the linked user owns. Reversible: the
   * world is hidden everywhere but recoverable via `world.restore` for the
   * server's retention window, after which it is permanently purged. Pass
   * `name` (resolved against your own worlds) or `guid`.
   */
  async delete(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<{ guid: string; name: string; deleted_at?: string; message: string } | { error: string }> {
    let r = await this.resolveGuid(arg);
    if (r.error) {
      // Not in the live list — it may already be trashed. Re-deleting a
      // trashed world is idempotent on the server (200, keeps deleted_at),
      // so fall back to the trash list rather than failing a by-name
      // re-delete with "no world found".
      const t = await this.resolveTrashedGuid(arg);
      if (t.error) return { error: r.error };
      r = t;
    }
    const w = await deleteWorld(this.cfg, r.guid!);
    return {
      guid: w.guid,
      name: w.name,
      deleted_at: w.deleted_at,
      message:
        `Moved '${w.name}' to trash. It's hidden everywhere but recoverable — ` +
        `call world.restore { guid: "${w.guid}" } (or world.trash to see all trashed worlds) ` +
        `before the retention window elapses and it's permanently deleted.`,
    };
  }

  /**
   * Restore a soft-deleted world. Because a trashed world no longer shows
   * in `world.list`, a `name` here is resolved against the TRASH list
   * (`world.trash`); a `guid` is used directly.
   */
  async restore(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<{ guid: string; name: string; message: string } | { error: string }> {
    const r = await this.resolveTrashedGuid(arg);
    if (r.error) return { error: r.error };
    const w = await restoreWorld(this.cfg, r.guid!);
    return {
      guid: w.guid,
      name: w.name,
      message: `Restored '${w.name}' — it's back in world.list and visible everywhere again.`,
    };
  }

  /**
   * List the linked user's soft-deleted (trashed) worlds, with how many
   * days each has left before it's permanently purged.
   */
  async trash(): Promise<{
    retention_days: number;
    worlds: Array<{ guid: string; name: string; title?: string; deleted_at?: string; purges_in_days?: number }>;
  }> {
    const t = await listTrash(this.cfg);
    return {
      retention_days: t.retention_days,
      worlds: t.worlds.map((w) => ({
        guid: w.guid,
        name: w.name,
        title: w.title,
        deleted_at: w.deleted_at,
        purges_in_days: purgesInDays(w.deleted_at, t.retention_days),
      })),
    };
  }

  /**
   * Resolve a name/guid against the TRASH list (for `world.restore`),
   * since a trashed world is absent from the active `world.list`.
   */
  private async resolveTrashedGuid(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<{ guid?: string; error?: string }> {
    const candidate = arg.guid ?? arg.name_or_guid ?? arg.name;
    if (!candidate) return { error: "must pass `name` or `guid`" };
    const looksLikeGuid = /^(wld_|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(candidate);
    if (arg.guid || looksLikeGuid) return { guid: candidate };
    const { worlds } = await listTrash(this.cfg);
    const matches: TrashedWorld[] = worlds.filter((w) => w.name === candidate);
    if (matches.length === 0) {
      return {
        error: `no trashed world named '${candidate}'. Call world.trash to see what can be restored, or pass an explicit guid.`,
      };
    }
    if (matches.length > 1) {
      const guids = matches.map((w) => w.guid).join(", ");
      return { error: `multiple trashed worlds named '${candidate}' (guids: ${guids}). Pass an explicit guid.` };
    }
    return { guid: matches[0].guid };
  }

  /** URL the user (or `world.launch`) opens in the browser to start a session. */
  playUrl(guid: string): string {
    return `${issuer().replace(/\/+$/, "")}/edit/${guid}`;
  }

  /**
   * Resolve a `name | guid | name_or_guid` argument to a concrete guid via
   * `world.list`. The AI is encouraged to call this with `name` (no guid
   * literacy required), but a guid is accepted for already-resolved cases.
   */
  private async resolveGuid(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<{ guid?: string; error?: string }> {
    const candidate = arg.guid ?? arg.name_or_guid ?? arg.name;
    if (!candidate) return { error: "must pass `name` or `name_or_guid`" };
    // Heuristic: a guid looks like 8-4-4-4-12 hex or starts with `wld_`.
    const looksLikeGuid = /^(wld_|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(candidate);
    if (arg.guid || looksLikeGuid) return { guid: candidate };
    const list = await this.list();
    const matches = list.filter((w) => w.name === candidate);
    if (matches.length === 0) {
      return {
        error: `no world found with name '${candidate}'. Call world.list to see what's available, or pass auto_create=true on world.connect to create it on demand.`,
      };
    }
    if (matches.length > 1) {
      const guids = matches.map((w) => w.guid).join(", ");
      return {
        error: `multiple worlds named '${candidate}' (guids: ${guids}). Pass an explicit guid to disambiguate, or rename one of them.`,
      };
    }
    return { guid: matches[0].guid };
  }

  async openInBrowser(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<{ url: string; message: string } | { error: string }> {
    const r = await this.resolveGuid(arg);
    if (r.error) return { error: r.error };
    const url = this.playUrl(r.guid!);
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
  async launch(arg: {
    name?: string;
    guid?: string;
    name_or_guid?: string;
  }): Promise<LaunchResult | { error: string }> {
    const r = await this.resolveGuid(arg);
    if (r.error) return { error: r.error };
    return this.launchByGuid(r.guid!);
  }

  private launchByGuid(guid: string): LaunchResult {
    const url = this.playUrl(guid);
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
    name?: string;
    guid?: string;
    name_or_guid?: string;
    timeout_ms?: number;
    auto_launch?: boolean;
  }): Promise<ConnectResult | { ok: false; error: string }> {
    const r = await this.resolveGuid(params);
    if (r.error) return { ok: false, error: r.error };
    const guid = r.guid!;

    const existing = this.activeSessions.get(guid);
    if (existing) {
      this.current = existing;
      return { ok: true, session_id: existing };
    }

    if (params.auto_launch) {
      const launchResult = this.launchByGuid(guid);
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
    const sessionId = await this.waitForSession(guid, timeoutMs);
    if (sessionId) {
      // Small grace period — let the engine finish its trusted-VM
      // bootstrap before the AI starts hitting it with execute()s.
      await new Promise((r) => setTimeout(r, SESSION_OPEN_GRACE_MS));
      this.current = sessionId;
      return { ok: true, session_id: sessionId };
    }

    const url = this.playUrl(guid);
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
