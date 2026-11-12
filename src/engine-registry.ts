import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rename, writeFile, mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cacheDir } from "./config.js";

/** A native engine this CLI launched, as the launch recorded it. */
export type LaunchedEngine = {
  pid: number;
  binary: string;
  world: string;
  branch?: string;
  headless: boolean;
  /** The conversation (`--context`) whose `zero open` launched it. */
  conversation?: string;
  /** The engine session the hosted connection reaches it by, once it is ready. */
  sessionId?: string;
  idleMinutes?: number;
  launchedAt: string;
  log?: string;
};

const runExecutable = promisify(execFile);

function registryPath(): string {
  return join(cacheDir(), "engines.json");
}

async function readRegistry(): Promise<LaunchedEngine[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(registryPath(), "utf8"));
    return Array.isArray(parsed) ? (parsed as LaunchedEngine[]) : [];
  } catch {
    return [];
  }
}

async function writeRegistry(engines: LaunchedEngine[]): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const pending = `${registryPath()}.${randomUUID()}`;
  try {
    await writeFile(pending, JSON.stringify(engines, null, 2), { mode: 0o600 });
    await rename(pending, registryPath());
  } finally {
    await rm(pending, { force: true });
  }
}

/**
 * Whether `engine.pid` is still the engine that was launched: the process runs
 * and its executable is the one launched, so a process id the system handed to
 * another program afterwards does not read as the engine.
 */
export async function isRunning(engine: LaunchedEngine): Promise<boolean> {
  try {
    process.kill(engine.pid, 0);
  } catch {
    return false;
  }
  try {
    // The path the launch started, as the process states it: an AppImage runs
    // from a mount of its own, so its executable is not the file launched.
    if (process.platform === "linux")
      return (await readFile(`/proc/${engine.pid}/cmdline`, "utf8")).split("\0")[0] === engine.binary;
    if (process.platform === "win32") {
      const { stdout } = await runExecutable(
        "tasklist",
        ["/FI", `PID eq ${engine.pid}`, "/FO", "CSV", "/NH"],
        { windowsHide: true, timeout: 10000 },
      );
      return stdout.toLowerCase().includes(`"${basename(engine.binary).toLowerCase()}"`);
    }
    const { stdout } = await runExecutable("ps", ["-p", String(engine.pid), "-o", "comm="], {
      timeout: 10000,
    });
    return basename(stdout.trim()) === basename(engine.binary);
  } catch {
    return false;
  }
}

/** The engines this CLI launched that still run; the record of any other is dropped. */
export async function runningEngines(): Promise<LaunchedEngine[]> {
  const recorded = await readRegistry();
  const running: LaunchedEngine[] = [];
  for (const engine of recorded) if (await isRunning(engine)) running.push(engine);
  if (running.length !== recorded.length) await writeRegistry(running);
  return running;
}

/** Record a launched engine. */
export async function recordEngine(engine: LaunchedEngine): Promise<void> {
  const engines = (await readRegistry()).filter((e) => e.pid !== engine.pid);
  engines.push(engine);
  await writeRegistry(engines);
}

/** Add what became known about a recorded engine after its launch. */
export async function updateEngine(pid: number, change: Partial<LaunchedEngine>): Promise<void> {
  const engines = await readRegistry();
  const engine = engines.find((e) => e.pid === pid);
  if (!engine) return;
  Object.assign(engine, change);
  await writeRegistry(engines);
}

/** Drop the record of an engine that has stopped. */
export async function forgetEngine(pid: number): Promise<void> {
  const engines = await readRegistry();
  const kept = engines.filter((e) => e.pid !== pid);
  if (kept.length !== engines.length) await writeRegistry(kept);
}

/** Stop a recorded engine and every process it started, then drop its record. */
export async function closeEngine(engine: LaunchedEngine): Promise<void> {
  if (await isRunning(engine)) {
    if (process.platform === "win32") {
      await runExecutable("taskkill", ["/PID", String(engine.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 15000,
      });
    } else {
      try {
        process.kill(-engine.pid, "SIGTERM");
      } catch {
        process.kill(engine.pid, "SIGTERM");
      }
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (await isRunning(engine)))
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      if (await isRunning(engine)) {
        try {
          process.kill(-engine.pid, "SIGKILL");
        } catch {
          process.kill(engine.pid, "SIGKILL");
        }
      }
    }
  }
  await forgetEngine(engine.pid);
}
