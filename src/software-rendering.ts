import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { checkHeadlessRenderer, type RendererDiagnostic } from "./engine-launch.js";

type Command = { program: string; args: string[] };

/** Commands for a distribution whose signed package repository supplies lavapipe. */
export function softwareDriverCommands(release: string, root: boolean): Command[] {
  const values = new Map(
    release.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^(ID|ID_LIKE)=(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9 _-]+))$/);
      return match ? [[match[1], match[2] ?? match[3] ?? match[4]]] : [];
    }),
  );
  const families = [values.get("ID"), ...(values.get("ID_LIKE") ?? "").split(/\s+/)];
  if (!families.some((id) => id === "debian" || id === "ubuntu"))
    throw new Error(
      "Automatic CPU-driver setup supports Debian/Ubuntu. Install your distribution's Vulkan loader and Mesa lavapipe, then run zero engine doctor --software-rendering.",
    );
  const command = (args: string[]): Command =>
    root ? { program: "apt-get", args } : { program: "sudo", args: ["-n", "apt-get", ...args] };
  return [
    command(["update"]),
    command(["install", "-y", "--no-install-recommends", "libvulkan1", "mesa-vulkan-drivers"]),
  ];
}

async function run(command: Command, log: (line: string) => void): Promise<void> {
  log(`Running ${command.program} ${command.args.join(" ")}`);
  const child = spawn(command.program, command.args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  });
  for (const output of [child.stdout, child.stderr]) {
    output.setEncoding("utf8");
    output.on("data", (text: string) => log(text.trimEnd()));
  }
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `CPU-driver setup stopped (${code ?? signal}). Run with root access or noninteractive sudo, then retry zero engine install --software-rendering.`,
            ),
          ),
    );
  });
}

const exec = promisify(execFile);
const defaults = {
  platform: process.platform as string,
  root: process.getuid?.() === 0,
  probe: (binary: string) =>
    checkHeadlessRenderer(binary, { world: "", headless: true, softwareRendering: true }),
  capabilities: async (binary: string) =>
    (
      await exec(binary, ["--help"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout,
  release: () => readFile("/etc/os-release", "utf8"),
  run,
  log: (line: string) => {
    process.stderr.write(line + "\n");
  },
};

/** Verify CPU rendering, provisioning Linux prerequisites when explicitly requested by install. */
export async function setupSoftwareRendering(
  binary: string,
  overrides: Partial<typeof defaults> = {},
): Promise<RendererDiagnostic> {
  const services = { ...defaults, ...overrides };
  let firstError: unknown;
  try {
    const renderer = await services.probe(binary);
    if (!renderer) throw new Error("The engine returned no CPU renderer diagnostic");
    return renderer;
  } catch (error) {
    firstError = error;
  }
  if (services.platform !== "linux") throw firstError;
  const help = await services.capabilities(binary);
  if (!help.includes("--software-rendering") || !help.includes("--check-renderer"))
    throw firstError;
  const commands = softwareDriverCommands(await services.release(), services.root);
  for (const command of commands) await services.run(command, services.log);
  const renderer = await services.probe(binary);
  if (!renderer)
    throw new Error("CPU-driver setup finished but the engine returned no renderer diagnostic");
  return renderer;
}
