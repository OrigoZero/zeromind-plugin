import { expect, it } from "vitest";
import { setupSoftwareRendering, softwareDriverCommands } from "../src/software-rendering.js";
import type { RendererDiagnostic } from "../src/engine-launch.js";

const renderer: RendererDiagnostic = {
  headless: true,
  kind: "cpu",
  adapter: "lavapipe",
  driver: "Mesa",
  width: 640,
  height: 360,
};

it("selects fixed signed-repository package commands and noninteractive privilege elevation", () => {
  expect(softwareDriverCommands('ID=ubuntu\nID_LIKE="debian"', true)).toEqual([
    { program: "apt-get", args: ["update"] },
    {
      program: "apt-get",
      args: ["install", "-y", "--no-install-recommends", "libvulkan1", "mesa-vulkan-drivers"],
    },
  ]);
  expect(softwareDriverCommands("ID=debian", false)[0]).toEqual({
    program: "sudo",
    args: ["-n", "apt-get", "update"],
  });
  expect(() => softwareDriverCommands("ID=$(arbitrary-command)", true)).toThrow(
    "supports Debian/Ubuntu",
  );
});

it("provisions only after a supported engine fails its CPU probe and verifies the result", async () => {
  const operations: string[] = [];
  let installed = false;
  const services = {
    platform: "linux",
    root: true,
    probe: async () => {
      operations.push("probe");
      if (!installed) throw new Error("no adapter");
      return renderer;
    },
    capabilities: async () => {
      operations.push("capabilities");
      return "--software-rendering --check-renderer";
    },
    release: async () => "ID=debian",
    run: async (command: { program: string; args: string[] }) => {
      operations.push(command.args[0]);
      if (command.args[0] === "install") installed = true;
    },
    log: () => {},
  };
  expect(await setupSoftwareRendering("native", services)).toEqual(renderer);
  expect(operations).toEqual(["probe", "capabilities", "update", "install", "probe"]);
  operations.length = 0;
  expect(await setupSoftwareRendering("native", services)).toEqual(renderer);
  expect(operations).toEqual(["probe"]);
});

it("changes no system packages for an old engine and stops after a package-manager failure", async () => {
  let commands = 0;
  const services = {
    platform: "linux",
    root: false,
    probe: async (): Promise<RendererDiagnostic> => {
      throw new Error("no CPU renderer");
    },
    capabilities: async () => "old engine",
    release: async () => "ID=ubuntu",
    run: async () => {
      commands++;
      throw new Error("apt failed");
    },
    log: () => {},
  };
  await expect(setupSoftwareRendering("native", services)).rejects.toThrow("no CPU renderer");
  expect(commands).toBe(0);
  await expect(
    setupSoftwareRendering("native", {
      ...services,
      capabilities: async () => "--software-rendering --check-renderer",
    }),
  ).rejects.toThrow("apt failed");
  expect(commands).toBe(1);
});
