#!/usr/bin/env node
// `zero` and `zeromind` connect shell callers and agent harnesses to hosted
// ZeroMind, and open worlds and transfer files from this machine.
const argv = process.argv.slice(2);
const command = argv[0];
const run = async (): Promise<void> => {
  if (command === "--version" || command === "-v") {
    const { VERSION } = await import("./package-version.js");
    process.stdout.write(VERSION + "\n");
    return;
  }
  if (command === "engine") {
    const { runEngineCli } = await import("./engine-install.js");
    await runEngineCli(argv.slice(1));
    return;
  }
  if (
    !command ||
    [
      "--help",
      "-h",
      "--context",
      "login",
      "whoami",
      "logout",
      "sessions",
      "connect",
      "disconnect",
      "tools",
      "call",
      "bash",
      "open",
    ].includes(command)
  ) {
    const { runRemoteCli } = await import("./cli-remote.js");
    await runRemoteCli(argv);
    return;
  }
  if (command === "install") {
    const { runInstallCli } = await import("./cli-install.js");
    await runInstallCli(argv.slice(1));
    return;
  }
  if (command === "upload") {
    const { runUploadCli } = await import("./cli-upload.js");
    await runUploadCli(argv.slice(1));
    return;
  }
  if (["link", "status", "unlink"].includes(command)) {
    const { runLinkCli } = await import("./cli-link.js");
    await runLinkCli(argv);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run zero --help.`);
};
// A failure is reported and the exit code set, never `process.exit()`: on
// Windows, exiting the process while a socket is still closing aborts it with
// a libuv assertion instead of the message and the code the caller expects.
run().catch((e) => {
  process.stderr.write(`zeromind: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
