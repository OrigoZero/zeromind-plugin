import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";
import { withTmpConfigDir } from "./helpers/tmp-config.js";
import { ensureRegistered } from "../src/install.js";
import { HivemindTools } from "../src/tools/hivemind.js";
import type { InstallConfig } from "../src/config.js";

describe("hivemind tools", () => {
  let server: MockServerHandle;
  let tmp: ReturnType<typeof withTmpConfigDir>;
  let cfg: InstallConfig;
  let hm: HivemindTools;

  beforeAll(async () => {
    server = await startMockServer({ port: 0 });
  });
  afterAll(async () => {
    await server.stop();
  });
  beforeEach(async () => {
    tmp = withTmpConfigDir();
    process.env.ZEROMIND_CONFIG_DIR = tmp.dir;
    process.env.ZEROMIND_ISSUER = server.url;
    cfg = await ensureRegistered({ ideName: "t" });
    server.forceApprove(cfg.install_id, "usr_hm");
    hm = new HivemindTools(cfg);
  });
  afterEach(() => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    delete process.env.ZEROMIND_ISSUER;
    tmp.cleanup();
  });

  describe("search", () => {
    it("defaults to asset discovery and forwards the query", async () => {
      const r = (await hm.search({ q: "voxel mesher", kind: "module" })) as {
        hits: unknown[];
        query_echo: { q: string; kind: string };
      };
      expect(r.hits).toHaveLength(1);
      expect(r.query_echo).toEqual({ q: "voxel mesher", kind: "module" });
    });

    it("routes scope=worlds, both, feed, kinds", async () => {
      expect((await hm.search({ scope: "worlds", q: "x" }) as { worlds: unknown[] }).worlds).toBeDefined();
      expect((await hm.search({ scope: "both", q: "x" }) as { assets: unknown[] }).assets).toBeDefined();
      expect((await hm.search({ scope: "feed", sort: "new" }) as { items: unknown[] }).items).toBeDefined();
      expect((await hm.search({ scope: "kinds" }) as { kinds: unknown[] }).kinds).toBeDefined();
    });

    it("routes scope=similar with the seed asset in the path", async () => {
      const r = (await hm.search({ scope: "similar", asset_guid: "ast_seed" })) as {
        query_echo: { seed_asset: string };
      };
      expect(r.query_echo.seed_asset).toBe("ast_seed");
    });

    it("requires kind for top_by_kind and asset_guid for similar", async () => {
      await expect(hm.search({ scope: "top_by_kind" })).rejects.toThrow(/kind/);
      await expect(hm.search({ scope: "similar" })).rejects.toThrow(/asset_guid/);
    });

    it("rejects an unknown scope", async () => {
      await expect(
        hm.search({ scope: "nonsense" as unknown as "assets" }),
      ).rejects.toThrow(/unknown scope/);
    });
  });

  describe("inspect", () => {
    it("world overview (default) aggregates detail + summary + comments", async () => {
      const r = (await hm.inspect({ target: "world", guid: "wld_1" })) as {
        detail: { guid: string };
        summary: { view: string };
        comments: unknown[];
      };
      expect(r.detail.guid).toBe("wld_1");
      expect(r.summary.view).toBe("summary");
      expect(Array.isArray(r.comments)).toBe(true);
    });

    it("world named views still work", async () => {
      const c = (await hm.inspect({ target: "world", guid: "wld_1", view: "contents" })) as {
        view: string;
      };
      expect(c.view).toBe("contents");
    });

    it("asset overview (default) aggregates detail + comments + dependents", async () => {
      const r = (await hm.inspect({ target: "asset", guid: "ast_1" })) as {
        detail: { asset_guid: string; capabilities: string[] };
        comments: unknown[];
        dependents: { pulled_by: unknown[] };
      };
      expect(r.detail.asset_guid).toBe("ast_1");
      expect(r.detail.capabilities).toContain("mock_capability");
      expect(Array.isArray(r.comments)).toBe(true);
      expect(r.dependents.pulled_by).toBeDefined();
    });

    it("asset detail view returns the single-asset record", async () => {
      const d = (await hm.inspect({ target: "asset", guid: "ast_1", view: "detail" })) as {
        asset_guid: string;
        readme_excerpt: string;
      };
      expect(d.asset_guid).toBe("ast_1");
      expect(d.readme_excerpt).toBe("Mock readme.");
    });

    it("asset closure view returns the closure", async () => {
      const r = (await hm.inspect({ target: "asset", guid: "ast_1", view: "closure" })) as {
        roots: string[];
      };
      expect(r.roots).toEqual(["ast_1"]);
    });

    it("rejects an unknown view", async () => {
      await expect(
        hm.inspect({ target: "asset", guid: "ast_1", view: "bogus" }),
      ).rejects.toThrow(/unknown asset view/);
    });
  });

  describe("pull", () => {
    it("posts the asset guids as closure items", async () => {
      const r = (await hm.pull({ asset_guids: ["ast_a", "ast_b"] })) as { roots: string[] };
      expect(r.roots).toEqual(["ast_a", "ast_b"]);
    });
    it("rejects an empty pull", async () => {
      await expect(hm.pull({ asset_guids: [] })).rejects.toThrow(/non-empty/);
    });
  });

  describe("engage", () => {
    it("votes on an asset (204 → ok)", async () => {
      const r = (await hm.engage({ action: "vote", target: "asset", guid: "ast_1", value: 1 })) as {
        ok: boolean;
      };
      expect(r.ok).toBe(true);
    });

    it("votes on a comment (returns score)", async () => {
      const r = (await hm.engage({ action: "vote", target: "comment", guid: "cmt_1", value: -1 })) as {
        score: number;
      };
      expect(r.score).toBe(1);
    });

    it("comments on an asset and returns the DTO", async () => {
      const r = (await hm.engage({
        action: "comment",
        target: "asset",
        guid: "ast_1",
        body: "nice work",
      })) as { comment_id: string; body: string };
      expect(r.comment_id).toBe("cmt_mock");
      expect(r.body).toBe("nice work");
    });

    it("submits an agent review", async () => {
      const r = (await hm.engage({
        action: "review",
        guid: "ast_1",
        compat_tier: "compatible",
        usability: 90,
        code_quality: 85,
        performance: 80,
      })) as { agent_score: number; compat_tier: string };
      expect(r.agent_score).toBe(86);
      expect(r.compat_tier).toBe("compatible");
    });

    it("records a pull adoption", async () => {
      const r = (await hm.engage({
        action: "record_pull",
        world_guid: "wld_1",
        asset_guid: "ast_1",
      })) as { created: boolean };
      expect(r.created).toBe(true);
    });

    it("validates required fields", async () => {
      await expect(hm.engage({ action: "comment", target: "asset", guid: "ast_1" })).rejects.toThrow(
        /body/,
      );
      await expect(hm.engage({ action: "review", guid: "ast_1" })).rejects.toThrow(/compat_tier/);
      await expect(hm.engage({ action: "record_pull", asset_guid: "ast_1" })).rejects.toThrow(
        /world_guid/,
      );
    });

    it("rejects an unknown action", async () => {
      await expect(
        hm.engage({ action: "explode" as unknown as "vote" }),
      ).rejects.toThrow(/unknown action/);
    });
  });
});
