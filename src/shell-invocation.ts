/** Quote one argument for the engine's POSIX shell parser. */
export function shellWord(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** Preserve argument boundaries when invoking a script or a parameterized command. */
export function shellInvocation(args: string[], readScript: () => string): string {
  if (args[0] === "-c" && args.length >= 2) {
    if (args.length === 2) return args[1];
    return ["bash", "-c", ...args.slice(1).map(shellWord)].join(" ");
  }
  if (args[0] === "-s" || args.length === 0) {
    const script = readScript();
    if (args.length <= 1) return script;
    return ["bash", "-c", shellWord(script), "zero-shell", ...args.slice(1).map(shellWord)].join(
      " ",
    );
  }
  const operands = args[0] === "--" ? args.slice(1) : args;
  if (operands[0] && (args[0] === "--" || !operands[0].startsWith("-")))
    return ["bash", "--", ...operands.map(shellWord)].join(" ");
  throw new Error(
    "Usage: zero bash -c '<command>' [arg0 args...], -s [args...], -i, or <engine-script> [args...]",
  );
}
