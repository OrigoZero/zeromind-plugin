import { fileURLToPath } from "node:url";

/** Startup file for routing noninteractive Bash invocations through Zero. */
export function bashEnvPath(): string {
  const path = fileURLToPath(new URL("../templates/bash-env.sh", import.meta.url));
  return process.platform === "win32" ? path.replaceAll("\\", "/") : path;
}

export function runBashEnvCli(args: string[]): void {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write(
      'zero bash-env\n\nPrint the startup-file path for noninteractive Bash.\nLaunch an agent with ZERO_CONTEXT=my-agent BASH_ENV="$(zero bash-env)" your-agent-command.\nSign in and connect the context with zero before launching it.\n',
    );
    return;
  }
  if (args.length) throw new Error("Usage: zero bash-env (prints the BASH_ENV startup-file path)");
  process.stdout.write(bashEnvPath() + "\n");
}
