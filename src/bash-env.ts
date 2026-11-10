import { fileURLToPath } from "node:url";

/** Startup file for routing noninteractive Bash invocations through Zero. */
export function bashEnvPath(): string {
  const path = fileURLToPath(new URL("../templates/bash-env.sh", import.meta.url));
  return process.platform === "win32" ? path.replaceAll("\\", "/") : path;
}

export function runBashEnvCli(args: string[]): void {
  if (args.length) throw new Error("Usage: zero bash-env (prints the BASH_ENV startup-file path)");
  process.stdout.write(bashEnvPath() + "\n");
}
