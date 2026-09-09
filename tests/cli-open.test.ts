import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockServer, type MockServerHandle } from "../tools/mock-zeromind/index.js";

const WORLD_GUID = "wld_open";
const WORLD_NAME = "Open World";

/** Point every home-anchored config path at `dir`. `os.homedir()` reads
 *  USERPROFILE on Windows and HOME elsewhere; APPDATA anchors the Windows
 *  config dir the CLI falls back to. */
const useHome = (dir: string): void => {
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.APPDATA = join(dir, "AppData/Roaming");
};

describe("zeromind open", () => {
  let server: MockServerHandle;
  let configDir: string;
  let home: string;
  let secret: string;
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    ZEROMIND_CONFIG_DIR: process.env.ZEROMIND_CONFIG_DIR,
  };

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
    server.forceApprove(registered.install_id, "usr_open");
    secret = registered.install_secret;
    server.state.worlds.set(WORLD_GUID, {
      guid: WORLD_GUID,
      name: WORLD_NAME,
      is_public: false,
      owner_user_id: "usr_open",
      created_by_install_id: registered.install_id,
    });

    home = mkdtempSync(join(tmpdir(), "zm-open-home-"));
    useHome(home);
    configDir = mkdtempSync(join(tmpdir(), "zm-open-cfg-"));
    writeFileSync(
      join(configDir, "session.json"),
      JSON.stringify({ ...registered, issuer: server.url }, null, 2),
    );
    process.env.ZEROMIND_CONFIG_DIR = configDir;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(configDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    await server.stop();
  });

  beforeEach(() => {
    // Every case decides the target for itself; a preference one wrote must
    // not decide the next one.
    rmSync(join(configDir, "open.json"), { force: true });
  });

  /** The CLI with nothing of the machine in it: a recorded opener, and an OS
   *  that answers what the case says it answers. */
  const drive = async (
    argv: string[],
    opts: { handler?: boolean; browserBase?: string } = {},
  ): Promise<{ opened: string[]; printed: string }> => {
    const { runOpenCli } = await import("../src/cli-open.js");
    const opened: string[] = [];
    const printed: string[] = [];
    await runOpenCli(argv, {
      hasNativeHandler: () => opts.handler ?? false,
      open: async (url) => {
        opened.push(url);
      },
      browserBase: opts.browserBase ?? "https://origozero.ai",
      out: (line) => printed.push(line),
    });
    return { opened, printed: printed.join("\n") };
  };

  it("opens a guid in the editor, in a browser, when this machine has no handler", async () => {
    const { opened, printed } = await drive([WORLD_GUID]);
    expect(opened).toEqual([`https://origozero.ai/edit/${WORLD_GUID}`]);
    expect(printed).toContain("edit in the browser");
    expect(printed).toContain("no zero:// handler");
  });

  it("opens the play route for --play", async () => {
    const { opened } = await drive([WORLD_GUID, "--play"]);
    expect(opened).toEqual([`https://origozero.ai/play/${WORLD_GUID}`]);
  });

  it("hands the URL to the desktop engine when this machine has a zero:// handler", async () => {
    const { opened, printed } = await drive([WORLD_GUID], { handler: true });
    expect(opened).toEqual([`zero://launch?world=${WORLD_GUID}&mode=editor&profile=editor`]);
    expect(printed).toContain("edit in the native");

    // The player face boots the runtime profile; without it the deep link
    // opens the editor.
    const play = await drive([WORLD_GUID, "--play"], { handler: true });
    expect(play.opened).toEqual([`zero://launch?world=${WORLD_GUID}&mode=ref&profile=runtime`]);
  });

  it("remembers the target a flag named, and honours it on a later bare call", async () => {
    // The handler is present throughout, so a bare call that opens a browser
    // tab can only be the remembered target answering.
    const first = await drive([WORLD_GUID, "--browser"], { handler: true });
    expect(first.opened).toEqual([`https://origozero.ai/edit/${WORLD_GUID}`]);
    expect(JSON.parse(readFileSync(join(configDir, "open.json"), "utf8"))).toEqual({
      target: "browser",
    });

    const later = await drive([WORLD_GUID], { handler: true });
    expect(later.opened).toEqual([`https://origozero.ai/edit/${WORLD_GUID}`]);
    expect(later.printed).toContain("open.json");

    const overridden = await drive([WORLD_GUID, "--native"], { handler: false });
    expect(overridden.opened).toEqual([
      `zero://launch?world=${WORLD_GUID}&mode=editor&profile=editor`,
    ]);
    expect(JSON.parse(readFileSync(join(configDir, "open.json"), "utf8"))).toEqual({
      target: "native",
    });
  });

  it("resolves a name against this account's worlds", async () => {
    // No `resolveWorld` is supplied, so the name goes to the mock's `/mcp`
    // `world.list` over a real client with the machine's own credential.
    const { opened, printed } = await drive([WORLD_NAME]);
    expect(opened).toEqual([`https://origozero.ai/edit/${WORLD_GUID}`]);
    expect(printed).not.toContain(secret);
  });

  it("reads a world out of an https URL and a zero:// URL without a call", async () => {
    const fromWeb = await drive([`${server.url}/play/${WORLD_GUID}`]);
    expect(fromWeb.opened).toEqual([`https://origozero.ai/play/${WORLD_GUID}`]);

    const fromNative = await drive([`zero://launch?world=${WORLD_GUID}&mode=ref`]);
    expect(fromNative.opened).toEqual([`https://origozero.ai/play/${WORLD_GUID}`]);
  });

  it("prints the URL and opens nothing for --dry-run", async () => {
    const { opened, printed } = await drive([WORLD_GUID, "--play", "--native", "--dry-run"]);
    expect(opened).toEqual([]);
    expect(printed).toContain(`Would open zero://launch?world=${WORLD_GUID}&mode=ref`);
    // A rehearsal leaves the machine as it found it.
    expect(existsSync(join(configDir, "open.json"))).toBe(false);
  });

  it("exits 1 naming a world this account does not have, and never prints the secret", async () => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "index.js"), "open", "No Such World"],
      { env: { ...process.env, ZEROMIND_CONFIG_DIR: configDir } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(code).toBe(1);
    expect(stderr).toContain("No Such World");
    expect(stdout).toBe("");
    expect(stdout + stderr).not.toContain(secret);
    expect(stdout + stderr).not.toContain("ins_sec_");
  });

  it("names the URL to open by hand when the opener cannot spawn", async () => {
    const { runOpenCli } = await import("../src/cli-open.js");
    await expect(
      runOpenCli([WORLD_GUID], {
        hasNativeHandler: () => false,
        open: async () => {
          throw new Error("spawn xdg-open ENOENT");
        },
        browserBase: "https://origozero.ai",
        out: () => {},
      }),
    ).rejects.toThrow(`could not open https://origozero.ai/edit/${WORLD_GUID}`);
  });
});
