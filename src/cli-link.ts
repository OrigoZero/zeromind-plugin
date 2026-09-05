/** `zeromind link | status | unlink` — the machine's one link to ZeroMind. */
export const runLinkCli = async (argv: string[]): Promise<void> => {
  process.stdout.write(`zeromind: ${argv[0] ?? "help"} is not available in this build yet\n`);
};
