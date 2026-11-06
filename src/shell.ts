#!/usr/bin/env node
import { runRemoteCli } from "./cli-remote.js";

// Shell-capable harnesses invoke this executable with -c and one command string.
const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(
    `zero-shell -c '<command>'\nzero-shell -s\n\nRuns commands in the engine selected by ZERO_CONTEXT (or CODEX_THREAD_ID).\nSign in with zero login and select a session with zero connect first.\nConfigure the harness to invoke this shell with -c and login mode disabled.\n`,
  );
} else {
  runRemoteCli(["bash", ...args]).catch((error) => {
    process.stderr.write(`zero-shell: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
