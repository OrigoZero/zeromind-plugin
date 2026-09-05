import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("refuses a ceiling it cannot read, naming the flag and the value", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    // A typo in a safety ceiling must not quietly restore the default the
    // caller was overriding.
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-bytes", "5OO"]),
    ).rejects.toThrow(/--max-bytes needs a positive number; got '5OO'/);
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-files", "0"]),
    ).rejects.toThrow(/--max-files needs a positive number; got '0'/);
    expect(server.state.mcpWrites).toEqual([]);
    expect(server.state.mcpConnectedWorld).toBeUndefined();
  });

  it("refuses a ceiling flag with no value at all", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-files"]),
    ).rejects.toThrow(/--max-files needs a positive number; got ''/);
    await expect(
      runUploadCli([payload, "--world", WORLD_NAME, "--max-bytes"]),
    ).rejects.toThrow(/--max-bytes needs a positive number; got ''/);
    expect(server.state.mcpWrites).toEqual([]);
  });

  it("never follows a symlink out of the folder it was given", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    const outside = mkdtempSync(join(tmpdir(), "zm-upload-outside-"));
    const secret = "host file the world must never see\n";
    writeFileSync(join(outside, "secret.txt"), secret);
    const tree = mkdtempSync(join(tmpdir(), "zm-upload-link-"));
    writeFileSync(join(tree, "keep.txt"), "kept\n");
    // A plain file symlink needs a privilege Windows grants only in developer
    // mode; a junction needs none (and is an ordinary symlink off Windows), so
    // at least the directory leg runs everywhere.
    const linked: string[] = [];
    try {
      symlinkSync(join(outside, "secret.txt"), join(tree, "leak.txt"), "file");
      linked.push("file");
    } catch {
      /* privilege not granted here */
    }
    try {
      symlinkSync(outside, join(tree, "leak-dir"), "junction");
      linked.push("dir");
    } catch {
      /* privilege not granted here */
    }
    if (linked.length === 0) {
      rmSync(outside, { recursive: true, force: true });
      rmSync(tree, { recursive: true, force: true });
      return;
    }
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runUploadCli([tree, "--world", WORLD_NAME]);
    } finally {
      write.mockRestore();
      rmSync(outside, { recursive: true, force: true });
      rmSync(tree, { recursive: true, force: true });
    }
    expect(linked.length, "no link was created, so nothing was proven").toBeGreaterThan(0);
    expect(server.state.mcpWrites.map((w) => w.path)).toEqual(["/source/keep.txt"]);
    const sent = server.state.mcpWrites.map((w) =>
      Buffer.from(w.content_b64, "base64").toString("utf8"),
    );
    expect(sent).not.toContain(secret);
  });

  it("refuses a tree nested past the depth ceiling", async () => {
    const { runUploadCli } = await import("../src/cli-upload.js");
    const deep = mkdtempSync(join(tmpdir(), "zm-upload-deep-"));
    let cursor = deep;
    for (let i = 0; i < 66; i++) {
      cursor = join(cursor, `d${i}`);
      mkdirSync(cursor);
    }
    writeFileSync(join(cursor, "bottom.txt"), "too deep\n");
    try {
      await expect(runUploadCli([deep, "--world", WORLD_NAME])).rejects.toThrow(
        /nested deeper than 64 directories/,
      );
    } finally {
      rmSync(deep, { recursive: true, force: true });
    }
    expect(server.state.mcpWrites).toEqual([]);
    expect(server.state.mcpConnectedWorld).toBeUndefined();
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
