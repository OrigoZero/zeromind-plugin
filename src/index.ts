#!/usr/bin/env node
// `zeromind` — links this machine to ZeroMind once, writes the `/mcp` server
// entry into an agent harness's own config, and uploads local files into a
// world. Every tool an agent then uses comes from https://origozero.ai/mcp;
// nothing runs here.
const argv = process.argv.slice(2);
const command = argv[0];
const run = async (): Promise<void> => {
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
  const { runLinkCli } = await import("./cli-link.js");
  await runLinkCli(argv);
};
// A failure is reported and the exit code set, never `process.exit()`: on
// Windows, exiting the process while a socket is still closing aborts it with
// a libuv assertion instead of the message and the code the caller expects.
run().catch((e) => {
  process.stderr.write(`zeromind: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
