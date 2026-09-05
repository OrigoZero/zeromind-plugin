import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";

const WORLD_GUID = "wld_upload";
const WORLD_NAME = "Upload World";
const ALPHA = Buffer.from("hello alpha\n", "utf8");
const BINARY = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x00]);

describe("zeromind upload", () => {
  let server: MockServerHandle;
  let configDir: string;
  let payload: string;

  beforeAll(async () => {
    server = await startMockServer({ port: 0 });

    // A linked machine: an install the mock knows, cached the way the engine
    // and the CLI both read it, with the mock as its issuer.
    const registered = (await (
      await fetch(`${server.url}/v1/installs/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ install_name: "zero-engine", public_key: "fakepk" }),
      })
    ).json()) as { install_id: string; install_secret: string };
    server.forceApprove(registered.install_id, "usr_upload");
    server.state.worlds.set(WORLD_GUID, {
      guid: WORLD_GUID,
      name: WORLD_NAME,
      is_public: false,
      owner_user_id: "usr_upload",
      created_by_install_id: registered.install_id,
    });

    configDir = mkdtempSync(join(tmpdir(), "zm-upload-cfg-"));
    writeFileSync(
      join(configDir, "session.json"),
      JSON.stringify({ ...registered, issuer: server.url }, null, 2),
    );
    process.env.ZEROMIND_CONFIG_DIR = configDir;

    // Two files, one of them nested and binary, so the relative tree and the
    // byte-exactness are both observable.
    payload = mkdtempSync(join(tmpdir(), "zm-upload-src-"));
    writeFileSync(join(payload, "a.txt"), ALPHA);
    mkdirSync(join(payload, "nested"));
    writeFileSync(join(payload, "nested", "b.bin"), BINARY);
  });

  afterAll(async () => {
    delete process.env.ZEROMIND_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
    await server.stop();
  });

  beforeEach(() => {
    server.state.mcpWrites = [];
    server.state.mcpConnectedWorld = undefined;
    server.state.connectRefusal = undefined;
  });

  it("lands a folder's files at their paths, byte for byte", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      await runUploadCli([payload, "--world", WORLD_NAME, "--to", "/source/pack"]);
    } finally {
      write.mockRestore();
    }

    const landed = new Map(
      server.state.mcpWrites.map((w) => [w.path, Buffer.from(w.content_b64, "base64")]),
    );
    expect([...landed.keys()].sort()).toEqual([
      "/source/pack/a.txt",
      "/source/pack/nested/b.bin",
    ]);
    expect(landed.get("/source/pack/a.txt")!.equals(ALPHA)).toBe(true);
    expect(landed.get("/source/pack/nested/b.bin")!.equals(BINARY)).toBe(true);
    expect(server.state.mcpConnectedWorld).toBe(WORLD_GUID);

    const out = printed.join("");
    expect(out).toContain("/source/pack/a.txt");
    expect(out).toContain("/source/pack/nested/b.bin");
    expect(out).toContain("2 file(s)");
    expect(out).not.toContain("ins_sec_");
  });

  it("connects to a world by guid, and defaults the destination to /source", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runUploadCli([join(payload, "a.txt"), "--world", WORLD_GUID]);
    } finally {
      write.mockRestore();
    }
    expect(server.state.mcpWrites.map((w) => w.path)).toEqual(["/source/a.txt"]);
  });

  it("refuses past the file-count ceiling before it writes anything", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-files", "1"]),
    ).rejects.toThrow(/max-files=1/);
    expect(server.state.mcpWrites).toEqual([]);
    expect(server.state.mcpConnectedWorld).toBeUndefined();
  });

  it("refuses past the byte ceiling before it writes anything", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-bytes", "4"]),
    ).rejects.toThrow(/max-bytes=4/);
    expect(server.state.mcpWrites).toEqual([]);
  });

  it("prints a refused world.connect and exits non-zero, having written nothing", async () => {
    server.state.connectRefusal =
      "more than one engine of yours could take this; session.list shows them, session.connect pins one";
    // Spawned asynchronously on purpose: the mock server runs in THIS process,
    // so a synchronous child would block the event loop that has to answer it.
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "index.js"), "upload", payload, "--world", WORLD_NAME],
      { env: { ...process.env, ZEROMIND_CONFIG_DIR: configDir } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(code).toBe(1);
    expect(stderr).toContain("session.connect pins one");
    expect(server.state.mcpWrites).toEqual([]);
    expect(stdout + stderr).not.toContain("ins_sec_");
  });
});
