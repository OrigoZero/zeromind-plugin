import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { setupSoftwareRendering } from "../src/software-rendering.js";
import { runtimeLoaderFixture } from "./fixtures/runtime-loader.mjs";

const supported =
  process.platform === "linux" && spawnSync("cc", ["--version"], { stdio: "ignore" }).status === 0;

it.skipIf(!supported)(
  "recovers a real ELF loader failure before --help and repeats without provisioning",
  async () => {
    const fixture = runtimeLoaderFixture();
    try {
      const before = spawnSync(fixture.binary, ["--help"], { encoding: "utf8" });
      expect(before.status).not.toBe(0);
      expect(before.stderr).toContain("error while loading shared libraries: libasound.so.2:");
      const commands: string[][] = [];
      const services = {
        platform: "linux",
        root: true,
        release: async () => "ID=ubuntu",
        run: async (command: { args: string[] }) => {
          commands.push(command.args);
          if (command.args[0] === "install") fixture.installRuntime();
        },
        log: () => {},
      };
      expect((await setupSoftwareRendering(fixture.binary, services)).adapter).toBe(
        "loader fixture",
      );
      expect(commands.map((args) => args[0])).toEqual(["update", "install"]);
      expect(commands[1]).toContain("libasound2t64");
      commands.length = 0;
      expect((await setupSoftwareRendering(fixture.binary, services)).kind).toBe("cpu");
      expect(commands).toEqual([]);
    } finally {
      fixture.dispose();
    }
  },
);
