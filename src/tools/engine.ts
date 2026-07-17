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
  // tool }.
  use_tool(params: {
    toolbox?: string;
    tool: string;
    args?: unknown[];
  }): Promise<unknown> {
    return call(this.bridge, this.world, "use_tool", params);
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
