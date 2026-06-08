import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineTools } from "../src/tools/engine.js";
import { uploadFile } from "../src/upload.js";

/** A stub EngineTools that records every write_file call. The bytes are
 *  decoded back from base64 so tests can assert binary integrity. */
type Capture = { path: string; bytes: Buffer };
const fakeEngine = (): { engine: EngineTools; calls: Capture[] } => {
  const calls: Capture[] = [];
  const engine = {
    write_file: async (params: { path: string; content?: string; content_b64?: string }) => {
      if (params.content_b64 === undefined) {
        throw new Error("upload must use content_b64, never content");
      }
      calls.push({ path: params.path, bytes: Buffer.from(params.content_b64, "base64") });
      return { ok: true as const };
    },
  } as unknown as EngineTools;
  return { engine, calls };
};

describe("uploadFile", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zm-upload-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("uploads a single binary file verbatim (no UTF-8 corruption)", async () => {
    // Bytes that are NOT valid UTF-8 — would be mangled if routed as text.
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01]);
    const src = path.join(tmp, "wall.png");
    await fs.writeFile(src, payload);

    const { engine, calls } = fakeEngine();
    const r = await uploadFile(engine, { local_path: src, vfs_path: "/source/textures/wall.png" });

    expect(r.uploaded).toBe(1);
    expect(r.bytes).toBe(payload.length);
    expect(r.vfs_path).toBe("/source/textures/wall.png");
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/source/textures/wall.png");
    expect(calls[0].bytes.equals(payload)).toBe(true);
  });

  it("uploads a folder recursively, mirroring the tree under vfs_path", async () => {
    await fs.mkdir(path.join(tmp, "models"), { recursive: true });
    await fs.mkdir(path.join(tmp, "textures"), { recursive: true });
    await fs.writeFile(path.join(tmp, "models", "car.glb"), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(tmp, "textures", "body.png"), Buffer.from([4, 5]));
    await fs.writeFile(path.join(tmp, "pack.json"), Buffer.from("{}"));

    const { engine, calls } = fakeEngine();
    const r = await uploadFile(engine, { local_path: tmp, vfs_path: "/source/pack/" });

    expect(r.uploaded).toBe(3);
    expect(r.bytes).toBe(7); // 3 (car.glb) + 2 (body.png) + 2 ("{}")
    // Trailing slash on vfs_path is normalised away.
    expect(r.vfs_path).toBe("/source/pack");
    const dests = calls.map((c) => c.path).sort();
    expect(dests).toEqual([
      "/source/pack/models/car.glb",
      "/source/pack/pack.json",
      "/source/pack/textures/body.png",
    ]);
    expect(r.files!.sort()).toEqual(dests);
  });

  it("skips symlinks during a folder walk", async () => {
    await fs.writeFile(path.join(tmp, "real.bin"), Buffer.from([9]));
    try {
      await fs.symlink(path.join(tmp, "real.bin"), path.join(tmp, "link.bin"));
    } catch {
      // Platform without symlink support — nothing to assert, bail cleanly.
      return;
    }
    const { engine, calls } = fakeEngine();
    const r = await uploadFile(engine, { local_path: tmp, vfs_path: "/source/x" });
    expect(r.uploaded).toBe(1);
    expect(calls.map((c) => c.path)).toEqual(["/source/x/real.bin"]);
  });

  it("aborts before any write when a single file exceeds max_bytes", async () => {
    const src = path.join(tmp, "big.bin");
    await fs.writeFile(src, Buffer.alloc(1000));
    const { engine, calls } = fakeEngine();
    await expect(
      uploadFile(engine, { local_path: src, vfs_path: "/source/big.bin", max_bytes: 500 }),
    ).rejects.toThrow(/exceeds max_bytes=500/);
    expect(calls).toHaveLength(0);
  });

  it("aborts before any write when a folder exceeds max_bytes (pre-flight)", async () => {
    await fs.writeFile(path.join(tmp, "a.bin"), Buffer.alloc(400));
    await fs.writeFile(path.join(tmp, "b.bin"), Buffer.alloc(400));
    const { engine, calls } = fakeEngine();
    await expect(
      uploadFile(engine, { local_path: tmp, vfs_path: "/source/x", max_bytes: 500 }),
    ).rejects.toThrow(/exceed max_bytes=500/);
    // Pre-flight budget check means nothing was written.
    expect(calls).toHaveLength(0);
  });

  it("enforces max_files on a folder upload", async () => {
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(tmp, `f${i}.bin`), Buffer.from([i]));
    }
    const { engine } = fakeEngine();
    await expect(
      uploadFile(engine, { local_path: tmp, vfs_path: "/source/x", max_files: 3 }),
    ).rejects.toThrow(/max_files=3/);
  });

  it("returns uploaded:0 for an empty folder", async () => {
    const empty = path.join(tmp, "empty");
    await fs.mkdir(empty);
    const { engine, calls } = fakeEngine();
    const r = await uploadFile(engine, { local_path: empty, vfs_path: "/source/x" });
    expect(r.uploaded).toBe(0);
    expect(r.files).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("expands a leading ~ to the home directory", async () => {
    // Write a file directly under the home dir, address it via ~, clean up.
    const name = `.zm-upload-test-${process.pid}-${Date.now()}.bin`;
    const homeFile = path.join(os.homedir(), name);
    await fs.writeFile(homeFile, Buffer.from([7, 7]));
    try {
      const { engine, calls } = fakeEngine();
      const r = await uploadFile(engine, { local_path: `~/${name}`, vfs_path: "/source/h.bin" });
      expect(r.uploaded).toBe(1);
      expect(calls[0].bytes.equals(Buffer.from([7, 7]))).toBe(true);
    } finally {
      await fs.rm(homeFile, { force: true });
    }
  });

  it("errors clearly when local_path does not exist", async () => {
    const { engine } = fakeEngine();
    await expect(
      uploadFile(engine, { local_path: path.join(tmp, "nope.bin"), vfs_path: "/source/x" }),
    ).rejects.toThrow(/cannot read local_path/);
  });

  it("rejects missing required args", async () => {
    const { engine } = fakeEngine();
    await expect(
      uploadFile(engine, { local_path: "", vfs_path: "/x" }),
    ).rejects.toThrow(/'local_path' is required/);
    await expect(
      uploadFile(engine, { local_path: tmp, vfs_path: "" }),
    ).rejects.toThrow(/'vfs_path' is required/);
  });
});
