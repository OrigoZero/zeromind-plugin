import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { listWorlds, createWorld } from "../src/zeromind-client.js";

describe("zeromind REST client (worlds)", () => {
  let server: MockServerHandle;
  let tmp: ReturnType<typeof withTmpConfigDir>;
  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });
  beforeEach(() => {
    tmp = withTmpConfigDir();
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
    process.env.ZEROMIND_ISSUER = server.url;
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
    tmp.cleanup();
  });

  it("creates a world and lists it", async () => {
    const cfg = await ensureRegistered({ ideName: "t" });
    server.forceApprove(cfg.install_id, "usr_t");
    const w = await createWorld(cfg, { name: "test-world" });
    expect(w.guid).toMatch(/^wld_/);
    expect(w.name).toBe("test-world");
    expect(w.owner_user_id).toBe("usr_t");
    const list = await listWorlds(cfg);
    expect(list.find((x) => x.guid === w.guid)).toBeDefined();
  });
});
