import { expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { stopLaunchedEngine } from "../src/engine-launch.js";

it.skipIf(process.platform === "win32")(
  "keeps an unreferenced launch alive through shutdown reporting",
  () => {
    const moduleUrl = new URL("../dist/engine-launch.js", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { stopLaunchedEngine } from ${JSON.stringify(moduleUrl)};
    async function run() {
      const child = spawn(process.execPath, ['-e',
        "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 200)); setTimeout(() => process.exit(0), 2000); process.stdout.write('ready');"
      ], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      await once(child.stdout, 'data');
      child.stdout.destroy();
      child.unref();
      await stopLaunchedEngine(child);
      console.log('cleanup-complete');
      process.exitCode = 23;
    }
    run().catch(error => { console.error(error.message); process.exitCode = 1; });
  `,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(23);
    expect(result.stdout.trim()).toBe("cleanup-complete");
  },
);

it("stops only its owned launch and accepts an already stopped process", async () => {
  for (let repeat = 0; repeat < 2; repeat++) {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000); process.stdout.write('ready');"],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      await once(child.stdout!, "data");
      expect(child.exitCode).toBeNull();
      await stopLaunchedEngine(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      await stopLaunchedEngine(child);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}, 15000);
