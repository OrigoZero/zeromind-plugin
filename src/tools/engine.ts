import type { Bridge } from "../bridge.js";
import type { WorldTools } from "./world.js";
import { NotConnectedError } from "../errors.js";

const call = <T = unknown>(
  bridge: Bridge,
  world: WorldTools,
  method: string,
  params: unknown = {},
): Promise<T> => {
  const session = world.currentSession();
  if (!session) throw new NotConnectedError();
  return bridge.call({ target_session: session, method, params }) as Promise<T>;
};

export class EngineTools {
  constructor(
    private bridge: Bridge,
    private world: WorldTools,
  ) {}

  // Engines from zero PR #3941 onward return the structured envelope
  // `{ result: <user-return>, logs?: string[], diagnostics?: [...],
  //    state: { mode, paused, timeScale, activeLayer, activeScene, world } }`
  // on success (a long-running script promotes to
  // `{ status: "running", taskId, location, state }`). Older engines returned
  // the bare value / `{ value }`. Consumers that match on the user's return
  // value should unwrap via `unwrapEngineValue` (tools/watch.ts).
  execute(params: { code: string }): Promise<unknown> {
    return call(this.bridge, this.world, "execute", params);
  }
  guides(
    params: {
      path?: string;
      query?: string;
      list?: boolean;
      limit?: number;
      context_lines?: number;
    } = {},
  ): Promise<unknown> {
    return call(this.bridge, this.world, "guides", params);
  }
  // Engine skills live in the world, not in the host environment, so this is
  // the only way to reach one. No `name` lists the roster; a `name` opens that
  // skill and HOLDS it open (it rides subsequent tool responses) until
  // `release`. The engine dispatches it through the `skills` toolbox, so this
  // surface and `tools.use("skills", ...)` never disagree.
  agent_skill(
    params: {
      name?: string;
      scope?: "builtin" | "world" | "library";
      release?: string;
    } = {},
  ): Promise<unknown> {
    return call(this.bridge, this.world, "agent_skill", params);
  }
  search_tools(
    params: {
      query?: string;
      toolbox?: string;
      limit?: number;
    } = {},
  ): Promise<unknown> {
    return call(this.bridge, this.world, "search_tools", params);
  }
  // The executing sibling of search_tools: search finds the workflow tool,
  // use_tool runs it. `args` is POSITIONAL (the tool's signature order).
  // Returns the tool's ZmToolResult envelope { ok, value | error, durationMs,
  // tool }. Pass `calls` (with an optional `mode`) instead of the single-call
  // fields to run a batch in one request; the reply is one batch envelope
  // { batch, mode, ok, ran, total, results }.
  use_tool(params: {
    toolbox?: string;
    tool?: string;
    args?: unknown[];
    calls?: { toolbox?: string; tool: string; args?: unknown[] }[];
    mode?: "sequential" | "parallel";
  }): Promise<unknown> {
    return call(this.bridge, this.world, "use_tool", params);
  }
  // The detail sibling of search_tools/use_tool: search LISTS tools compactly,
  // describe_tool returns ONE tool's full assembled schema. Same data as
  // `zero <toolbox> <tool> --help` in the engine shell.
  describe_tool(params: { toolbox?: string; tool: string }): Promise<unknown> {
    return call(this.bridge, this.world, "describe_tool", params);
  }
  // BLOCKING counterpart to the non-blocking `track` watcher: waits inline on a
  // promoted task. The engine caps the block at 20s to stay under the MCP
  // transport timeout and re-promotes past it, so a still-running task comes
  // back as `{ status: "running", taskId }` and you call wait again.
  wait(params: {
    taskId: number;
    timeout_secs?: number;
    logs?: "error" | "warn" | "info" | "debug";
  }): Promise<unknown> {
    return call(this.bridge, this.world, "wait", params);
  }
  // Run-state control. All three return `{ mode, paused }`. `play` is refused
  // while user content under /zero/source has error-severity LSP diagnostics;
  // `pause` freezes without leaving the current mode.
  play(): Promise<{ mode: string; paused: boolean }> {
    return call(this.bridge, this.world, "play", {});
  }
  edit(): Promise<{ mode: string; paused: boolean }> {
    return call(this.bridge, this.world, "edit", {});
  }
  pause(params: { paused?: boolean } = {}): Promise<{ mode: string; paused: boolean }> {
    return call(this.bridge, this.world, "pause", params);
  }
  // Renders an asset through its type's preview() hook. Asset types without one
  // answer `available: false` with a reason rather than failing.
  preview(params: {
    asset: string;
    width?: number;
    height?: number;
  }): Promise<unknown> {
    return call(this.bridge, this.world, "preview", params);
  }
  // Resolves the full closure an install would write — every file and
  // dependency with dest_path, size, hash and why it is included — and writes
  // nothing. The vetting step before zeromind.install.
  zeromind_preview(params: { guid: string; at?: string; ref?: string }): Promise<unknown> {
    return call(this.bridge, this.world, "zeromind_preview", params);
  }
  // World publishing metadata, through the engine's trusted ZeroMind bridge.
  // Both require maintainer access; omitted fields are left unchanged.
  edit_world_metadata(params: {
    world_guid?: string;
    title?: string;
    description?: string;
    body?: string;
    tags?: string[];
    topics?: string[];
    visibility?: "public" | "unlisted" | "private";
    category?: string;
  }): Promise<unknown> {
    return call(this.bridge, this.world, "edit_world_metadata", params);
  }
  set_world_cover(
    params: {
      world_guid?: string;
      source?: "viewport" | "vfs_path" | "blob_sha256";
      vfs_path?: string;
      blob_sha256?: string;
      content_type?: string;
    } = {},
  ): Promise<unknown> {
    return call(this.bridge, this.world, "set_world_cover", params);
  }
  capture(
    params: {
      pass?: string;
      layers?: string[];
      width?: number;
      height?: number;
      format?: string;
    } = {},
    // The engine returns an MCP image content block: { type, mime_type, data }
    // (data = base64 PNG). NOT a flat { image_b64, width, height } — that shape
    // never existed on the wire. See zero crates/zero_code_mode/src/mcp_tools.rs.
  ): Promise<{ type: "image"; mime_type: string; data: string }> {
    return call(this.bridge, this.world, "capture", params);
  }
  read_file(params: { path: string }): Promise<{ content?: string; content_b64?: string }> {
    return call(this.bridge, this.world, "read_file", params);
  }
  write_file(params: {
    path: string;
    content?: string;
    content_b64?: string;
    quiet?: boolean;
  }): Promise<{ ok: true }> {
    return call(this.bridge, this.world, "write_file", params);
  }
  edit_file(params: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
    quiet?: boolean;
  }): Promise<{ ok: true }> {
    return call(this.bridge, this.world, "edit_file", params);
  }
  bash(params: {
    command: string;
  }): Promise<{ stdout: string; stderr: string; exit_code: number }> {
    return call(this.bridge, this.world, "bash", params);
  }
  luau_test(params: { filter?: string } = {}): Promise<unknown> {
    return call(this.bridge, this.world, "luau_test", params);
  }
  instance_health(): Promise<unknown> {
    return call(this.bridge, this.world, "instance_health", {});
  }
}
