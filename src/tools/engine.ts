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
  capture(
    params: {
      pass?: string;
      layers?: string[];
      width?: number;
      height?: number;
      format?: string;
    } = {},
  ): Promise<{ image_b64: string; width: number; height: number; format: string }> {
    return call(this.bridge, this.world, "capture", params);
  }
  read_file(params: { path: string }): Promise<{ content?: string; content_b64?: string }> {
    return call(this.bridge, this.world, "read_file", params);
  }
  write_file(params: {
    path: string;
    content?: string;
    content_b64?: string;
  }): Promise<{ ok: true }> {
    return call(this.bridge, this.world, "write_file", params);
  }
  edit_file(params: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
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
