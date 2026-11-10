import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { McpHttpClient, type ToolOutcome } from "./mcp-client.js";
import { installEngine, installedEngine } from "./engine-install.js";
import { cacheDir } from "./config.js";
import { openWithPlatform } from "./cli-open.js";

type Session = {
  session_id: string;
  world_guid: string;
  branch: string;
  kind: string;
  drivable: boolean;
  claimed_by_another: boolean;
};
type Caller = Pick<McpHttpClient, "callTool">;
type ListedWorld = { guid: string; name: string; default_branch?: string };
type HostedData = Record<string, unknown> & {
  worlds?: ListedWorld[];
  sessions?: Session[];
  pinned?: string | { session_id?: string } | null;
  open?: { native?: string; browser?: string };
  connected?: boolean;
  switched?: boolean;
  branch?: string;
};
export function toolData(result: ToolOutcome): HostedData {
  if (result.isError) throw new Error(result.text);
  if (result.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent as HostedData;
  const data: unknown = JSON.parse(result.text);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Hosted operation returned an invalid result");
  return data as HostedData;
}

export async function findEngine(explicit?: string): Promise<string | undefined> {
  const override = explicit ?? process.env.ZERO_ENGINE_BIN;
  if (override) {
    const path = resolve(override);
    if (!existsSync(path)) throw new Error(`Engine executable does not exist: ${path}`);
    return path;
  }
  const installed = await installedEngine();
  if (installed) return installed.binary;
  if (process.platform === "win32") {
    try {
      const registration = execFileSync(
        "reg",
        ["query", "HKCU\\Software\\Classes\\zero\\shell\\open\\command", "/ve"],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      const candidate = registration.match(/REG_SZ\s+"([^"]+)"/)?.[1];
      if (candidate && isAbsolute(candidate) && existsSync(candidate)) return candidate;
    } catch {
      /* Standard installation paths are checked below. */
    }
  }
  const candidates =
    process.platform === "win32"
      ? [
          join(
            process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
            "ZeroEngine",
            "current",
            "native.exe",
          ),
        ]
      : process.platform === "darwin"
        ? [
            join(homedir(), "Applications/Zero.app/Contents/MacOS/native"),
            "/Applications/Zero.app/Contents/MacOS/native",
          ]
        : [];
  return candidates.find((path) => existsSync(path));
}

export type OpenOptions = {
  world: string;
  branch?: string;
  session?: string;
  native?: boolean;
  browser?: boolean;
  bin?: string;
  newSession?: boolean;
  timeoutMs?: number;
  headless?: boolean;
  softwareRendering?: boolean;
  width?: number;
  height?: number;
};

export function nativeLaunchArgs(options: OpenOptions, launchUrl: string): string[] {
  if (options.softwareRendering && !options.headless)
    throw new Error("--software-rendering requires --headless");
  if ((options.width !== undefined || options.height !== undefined) && !options.headless)
    throw new Error("--width and --height require --headless");
  if (options.browser && (options.headless || options.softwareRendering))
    throw new Error("Headless and software rendering select a native engine");
  const args = [launchUrl, ...(options.branch ? ["--branch", options.branch] : [])];
  if (options.headless) {
    const width = options.width ?? (options.softwareRendering ? 640 : 1280);
    const height = options.height ?? (options.softwareRendering ? 360 : 720);
    for (const dimension of [width, height])
      if (!Number.isInteger(dimension) || dimension < 1 || dimension > 8192)
        throw new Error("Framebuffer dimensions must be integers from 1 to 8192");
    args.push("--headless", "--headless-width", String(width), "--headless-height", String(height));
  }
  if (options.softwareRendering) args.push("--software-rendering");
  return args;
}

const runExecutable = promisify(execFile);

/** Each engine establishes its own portable-application location. */
function engineEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, APPIMAGE: undefined, APPDIR: undefined };
}

/** Stop the process tree created by a launch that failed to become ready. */
export async function stopLaunchedEngine(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  if (process.platform === "win32") {
    await runExecutable("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10000,
    }).catch((error) => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* The owned process group may already have exited. */
      }
    }, 5000);
    timer.unref();
    try {
      await exited;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  await exited;
}

/** Exercise the requested renderer before issuing a short-lived launch credential. */
export type RendererDiagnostic = {
  headless: true;
  adapter: string;
  driver: string;
  kind: string;
  width: number;
  height: number;
};

export async function checkHeadlessRenderer(
  binary: string,
  options: OpenOptions,
): Promise<RendererDiagnostic | undefined> {
  if (!options.headless) return;
  const args = nativeLaunchArgs({ ...options, branch: undefined }, "").slice(1);
  let stdout: string;
  try {
    ({ stdout } = await runExecutable(binary, [...args, "--check-renderer"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: engineEnvironment(),
    }));
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(
      `Headless renderer check failed: ${failure.stderr?.trim() || failure.message}\nUpdate the engine with zero engine install. CPU rendering requires a software graphics driver such as Mesa lavapipe on Linux or D3D12 WARP on Windows.`,
    );
  }
  const report = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith("{"));
  let value: Partial<RendererDiagnostic> | null;
  try {
    value = JSON.parse(report ?? "");
  } catch {
    throw new Error(
      "The engine returned no renderer diagnostic; update it with zero engine install.",
    );
  }
  if (
    !value ||
    value.headless !== true ||
    typeof value.kind !== "string" ||
    typeof value.adapter !== "string" ||
    typeof value.driver !== "string" ||
    value.width !== (options.width ?? (options.softwareRendering ? 640 : 1280)) ||
    value.height !== (options.height ?? (options.softwareRendering ? 360 : 720)) ||
    (options.softwareRendering && value.kind !== "cpu")
  )
    throw new Error("The engine did not confirm the requested offscreen CPU/GPU renderer.");
  return value as RendererDiagnostic;
}

export async function openEngine(
  client: Caller,
  options: OpenOptions,
  log = (line: string) => {
    process.stderr.write(line + "\n");
  },
): Promise<HostedData> {
  nativeLaunchArgs(options, "");
  if (options.native && options.browser) throw new Error("Choose --native or --browser");
  if (options.session && (options.newSession || options.bin || options.headless))
    throw new Error("Choose an existing --session or launch a new executable");
  if (options.browser && options.bin) throw new Error("--bin selects a native executable");
  const createNew = options.newSession || Boolean(options.bin) || options.headless;
  const worlds = toolData(await client.callTool("world.list", {})).worlds as ListedWorld[];
  const matches = worlds.filter(
    (world) => world.guid === options.world || world.name === options.world,
  );
  let world = options.world;
  if (matches.length === 1) world = matches[0].guid;
  else if (matches.length > 1)
    throw new Error("Several worlds have that name; select a world guid");
  else if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(world))
    throw new Error(`World not found: ${options.world}`);
  const listed = toolData(await client.callTool("session.list", {}));
  const sessions = (listed.sessions ?? []) as Session[];
  const available = sessions.filter(
    (s) =>
      s.drivable &&
      !s.claimed_by_another &&
      s.world_guid === world &&
      (!options.native || s.kind === "native") &&
      (!options.browser || s.kind === "browser"),
  );
  const pinned = typeof listed.pinned === "string" ? listed.pinned : listed.pinned?.session_id;
  if (!options.branch && !options.session) {
    const branch =
      available.find((s) => s.session_id === pinned)?.branch ?? matches[0]?.default_branch;
    if (branch !== undefined) {
      if (typeof branch !== "string" || !branch)
        throw new Error("The world listing returned an invalid branch");
      options = { ...options, branch };
    }
  }
  const candidates = available.filter((s) => !options.branch || s.branch === options.branch);
  const named = options.session
    ? sessions.find((s) => s.session_id === options.session)
    : undefined;
  if (options.session && !named)
    throw new Error("The named engine is not available; list sessions again");
  if (
    named &&
    ((options.native && named.kind !== "native") || (options.browser && named.kind !== "browser"))
  )
    throw new Error("The named session does not match the requested engine kind");
  const existing =
    named ??
    candidates.find((s) => s.session_id === pinned) ??
    (!createNew && candidates.length === 1 ? candidates[0] : undefined);
  if (existing && !createNew) {
    const result = toolData(
      await client.callTool("session.connect", {
        session: existing.session_id,
        world,
        ...(options.branch ? { branch: options.branch } : {}),
      }),
    );
    if (!result.connected) throw new Error("The selected engine did not connect");
    const ready = toolData(await client.callTool("execute", { code: "return true" }));
    if (ready.result !== true)
      throw new Error("The selected engine did not confirm command readiness");
    return result;
  }
  if (!createNew && candidates.length > 1)
    throw new Error("Several engines match; choose --session <id> or --new");
  // Install before requesting the short-lived handoff.
  const binary = options.browser
    ? undefined
    : ((await findEngine(options.bin)) ?? (await installEngine({ log })).binary);
  if (binary) await checkHeadlessRenderer(binary, options);
  toolData(await client.callTool("world.disconnect", {}));
  const launched = toolData(
    await client.callTool("world.launch", {
      guid: world,
      ...(!options.browser ? { native: true } : {}),
      ...(options.branch ? { branch: options.branch } : {}),
    }),
  );
  let child: ReturnType<typeof spawn> | undefined;
  let ended: string | undefined;
  let logfile: string | undefined;
  if (binary) {
    const launchUrl = launched.open?.native;
    if (typeof launchUrl !== "string" || !new URL(launchUrl).searchParams.has("handoff"))
      throw new Error(
        "The server did not return an authorized native launch; update the hosted service before launching with the CLI agent identity.",
      );
    const logs = join(cacheDir(), "logs");
    await mkdir(logs, { recursive: true });
    logfile = join(logs, `engine-${randomUUID()}.log`);
    const fd = openSync(logfile, "wx", 0o600);
    try {
      child = spawn(binary, nativeLaunchArgs(options, launchUrl), {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", fd, fd],
        env: engineEnvironment(),
      });
      await new Promise<void>((ready, fail) => {
        child!.once("spawn", ready);
        child!.once("error", fail);
      });
      child.once("exit", (code, signal) => {
        ended = `exit ${code ?? signal}`;
      });
      child.unref();
    } finally {
      closeSync(fd);
    }
    log(`Native engine starting. Log: ${logfile}`);
  } else {
    const address = launched.open?.browser;
    if (typeof address !== "string")
      throw new Error("The server returned no browser launch address");
    await openWithPlatform(address);
    log("Browser engine opening.");
  }
  const before = new Set(sessions.map((s) => s.session_id));
  const deadline = Date.now() + (options.timeoutMs ?? 180000);
  let interrupted = false;
  const interruptLaunch = () => {
    interrupted = true;
  };
  process.on("SIGINT", interruptLaunch);
  process.on("SIGTERM", interruptLaunch);
  try {
    while (Date.now() < deadline) {
      if (interrupted) throw new Error("Engine launch interrupted");
      const now = toolData(await client.callTool("session.list", {}));
      const appeared = (now.sessions as Session[]).filter(
        (s) =>
          !before.has(s.session_id) &&
          s.world_guid === world &&
          s.drivable &&
          !s.claimed_by_another &&
          (!binary || s.kind === "native") &&
          (!options.branch || s.branch === options.branch || options.browser),
      );
      if (appeared.length > 1)
        throw new Error("Multiple new engines appeared; choose the intended session explicitly");
      if (appeared[0]) {
        let result = toolData(
          await client.callTool("session.connect", {
            session: appeared[0].session_id,
            world,
            ...(options.branch && !options.browser ? { branch: options.branch } : {}),
          }),
        );
        if (!result.connected) throw new Error("The new engine did not connect");
        if (options.branch && appeared[0].branch !== options.branch) {
          result = toolData(
            await client.callTool("world.open", {
              world,
              branch: options.branch,
              session: appeared[0].session_id,
            }),
          );
          if (!result.switched || result.branch !== options.branch)
            throw new Error("The engine did not confirm the requested branch");
        }
        const ready = toolData(await client.callTool("execute", { code: "return true" }));
        if (ready.result !== true)
          throw new Error("The engine connected but did not confirm command readiness");
        log("Engine connected and ready.");
        return { ...result, ...(logfile ? { log: logfile } : {}) };
      }
      if (ended) throw new Error(`Native engine stopped during launch (${ended}). Log: ${logfile}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    throw new Error(
      `Engine readiness timed out.${logfile ? ` Inspect ${logfile}.` : " Check the browser's boot status."}`,
    );
  } catch (error) {
    if (child) {
      try {
        await stopLaunchedEngine(child);
      } catch (cleanupError) {
        throw new Error(
          `${(error as Error).message}\nCould not stop the launched engine (${child.pid}): ${(cleanupError as Error).message}`,
        );
      }
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", interruptLaunch);
    process.removeListener("SIGTERM", interruptLaunch);
  }
}
