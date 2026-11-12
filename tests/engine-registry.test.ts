import { afterEach, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeEngine, isRunning, recordEngine, runningEngines } from "../src/engine-registry.js";

let dir: string;
let previous: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zero-engine-registry-"));
  previous = process.env.ZEROMIND_CONFIG_DIR;
  process.env.ZEROMIND_CONFIG_DIR = dir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.ZEROMIND_CONFIG_DIR;
  else process.env.ZEROMIND_CONFIG_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A stand-in engine: a process that starts one child of its own (a sub-client) and stays up. */
async function startEngine(pidFile: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const { spawn } = require('node:child_process');
       const sub = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
       require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(sub.pid));
       setTimeout(() => {}, 60000);`,
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  const deadline = Date.now() + 10000;
  while (!existsSync(pidFile) && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  return { pid: child.pid!, subPid: Number(readFileSync(pidFile, "utf8")) };
}

it("lists the engines it launched while they run and closes one with its sub-clients", async () => {
  for (let round = 0; round < 2; round++) {
    const { pid, subPid } = await startEngine(join(dir, `sub-${round}`));
    await recordEngine({
      pid,
      binary: process.execPath,
      world: "w",
      headless: true,
      conversation: "c",
      launchedAt: new Date().toISOString(),
    });
    expect((await runningEngines()).map((e) => e.pid)).toEqual([pid]);
    await closeEngine((await runningEngines())[0]);
    const deadline = Date.now() + 10000;
    while ((alive(pid) || alive(subPid)) && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(alive(pid)).toBe(false);
    expect(alive(subPid)).toBe(false);
    expect(await runningEngines()).toEqual([]);
  }
});

it("drops a record whose process is gone or now runs another program", async () => {
  const other = { binary: join(dir, "not-the-engine"), world: "w", headless: false, launchedAt: "" };
  // This test's own process runs, but not the recorded executable.
  await recordEngine({ ...other, pid: process.pid });
  expect(await isRunning({ ...other, pid: process.pid })).toBe(false);
  const gone = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolveExit) => gone.once("exit", resolveExit));
  await recordEngine({ ...other, binary: process.execPath, pid: gone.pid! });
  expect(await runningEngines()).toEqual([]);
  expect(JSON.parse(readFileSync(join(dir, "engines.json"), "utf8"))).toEqual([]);
});
