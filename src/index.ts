#!/usr/bin/env node
// `zeromind` — links this machine to ZeroMind once and writes the `/mcp`
// server entry into an agent harness's own config. Every tool an agent then
// uses comes from https://origozero.ai/mcp; nothing runs here.
const argv = process.argv.slice(2);
const command = argv[0];
const run = async (): Promise<void> => {
  if (command === "install") {
    const { runInstallCli } = await import("./cli-install.js");
    await runInstallCli(argv.slice(1));
    return;
  }
  const { runLinkCli } = await import("./cli-link.js");
  await runLinkCli(argv);
};
run().catch((e) => {
  process.stderr.write(`zeromind: ${(e as Error).message}\n`);
  process.exit(1);
});
