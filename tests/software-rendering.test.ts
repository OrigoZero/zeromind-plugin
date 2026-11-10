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
      args: [
        "install",
        "-y",
        "--no-install-recommends",
        "ca-certificates",
        "libstdc++6",
        "libgcc-s1",
        "libssl3t64",
        "libudev1",
        "libdbus-1-3",
        "libasound2t64",
        "libvulkan1",
        "mesa-vulkan-drivers",
      ],
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

it.each(["libasound.so.2", "libdbus-1.so.3", "libstdc++.so.6"])(
  "installs missing %s before inspecting engine capabilities",
  async (library) => {
    const operations: string[] = [];
    let installed = false;
    const failure = new Error(
      `native: error while loading shared libraries: ${library}: cannot open shared object file: No such file or directory`,
    );
    const services = {
      platform: "linux",
      root: true,
      probe: async () => {
        operations.push("probe");
        if (!installed) throw failure;
        return renderer;
      },
      capabilities: async () => {
        operations.push("capabilities");
        if (!installed) throw failure;
        return "--software-rendering --check-renderer";
      },
      release: async () => "ID=ubuntu",
      run: async (command: { args: string[] }) => {
        operations.push(command.args[0]);
        if (command.args[0] === "install") installed = true;
      },
      log: () => {},
    };
    expect(await setupSoftwareRendering("native", services)).toEqual(renderer);
    expect(operations).toEqual([
      "probe",
      "capabilities",
      "update",
      "install",
      "capabilities",
      "probe",
    ]);
    operations.length = 0;
    expect(await setupSoftwareRendering("native", services)).toEqual(renderer);
    expect(operations).toEqual(["probe"]);
  },
);

it.each([
  "native: /lib/libc.so.6: version GLIBC_2.43 not found",
  "native: error while loading shared libraries: libcuda.so.1: cannot open shared object file",
])("preserves an unsupported loader failure without changing packages: %s", async (message) => {
  let commands = 0;
  const failure = new Error(message);
  await expect(
    setupSoftwareRendering("native", {
      platform: "linux",
      root: true,
      probe: async () => {
        throw failure;
      },
      capabilities: async () => {
        throw failure;
      },
      release: async () => "ID=ubuntu",
      run: async () => {
        commands++;
      },
      log: () => {},
    }),
  ).rejects.toThrow(message);
  expect(commands).toBe(0);
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
