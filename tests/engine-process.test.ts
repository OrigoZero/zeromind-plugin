import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stopLaunchedEngine } from "../src/engine-launch.js";

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
