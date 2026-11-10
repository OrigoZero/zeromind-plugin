import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  chooseRelease,
  containedPath,
  installEngine,
  installedEngine,
  platformChannel,
} from "../src/engine-install.js";
let server: Server | undefined, root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

it.skipIf(process.platform !== "linux")(
  "installs an AppImage update as a reusable direct-execution tree",
  async () => {
    root = mkdtempSync(join(tmpdir(), "zero-appimage-test-"));
    vi.stubEnv("ZERO_ENGINE_DIR", root);
    const bytes = readFileSync("tests/fixtures/engine/appimage.nupkg");
    let downloads = 0;
    server = createServer((req, res) => {
      if (req.url?.endsWith(".json")) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            Assets: [
              {
                PackageId: "ZeroEngine",
                Version: "0.0.1",
                Type: "Full",
                FileName: "engine.nupkg",
                Size: bytes.length,
                SHA256: createHash("sha256").update(bytes).digest("hex"),
              },
            ],
          }),
        );
      } else {
        downloads++;
        res.end(bytes);
      }
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    vi.stubEnv(
      "ZEROMIND_ISSUER",
      `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    );
    const options = { platform: "linux" as const, arch: "x64", log: () => {} };
    const first = await installEngine(options);
    expect(first.binary).toContain(".appimage/squashfs-root/AppRun");
    expect(execFileSync(first.binary, ["--version"], { encoding: "utf8" })).toBe(
      "linux-test-engine\n",
    );
    expect(await installEngine(options)).toEqual(first);
    expect(downloads).toBe(1);
    expect(execFileSync(first.binary, ["--version"], { encoding: "utf8" })).toBe(
      "linux-test-engine\n",
    );
  },
);

it("verifies and installs a release once, keeping the current engine after a bad update", async () => {
  root = mkdtempSync(join(tmpdir(), "zero-engine-install-"));
  vi.stubEnv("ZERO_ENGINE_DIR", root);
  let bytes = readFileSync("tests/fixtures/engine/tiny.nupkg"),
    version = "0.0.1",
    corrupt = false,
    downloads = 0;
  server = createServer((req, res) => {
    if (req.url?.endsWith(".json")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          Assets: [
            {
              PackageId: "ZeroEngine",
              Version: version,
              Type: "Full",
              FileName: "engine.nupkg",
              Size: bytes.length,
              SHA256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        }),
      );
    } else {
      downloads++;
      res.end(corrupt ? Buffer.alloc(bytes.length) : bytes);
    }
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  vi.stubEnv("ZEROMIND_ISSUER", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const options = { platform: "win32" as const, arch: "x64", log: () => {} };
  const first = await installEngine(options);
  expect(readFileSync(first.binary, "utf8")).toBe("windows-test-engine");
  expect(await installEngine(options)).toEqual(first);
  expect(downloads).toBe(1);
  unlinkSync(join(root, "current.json"));
  expect(await installEngine(options)).toEqual(first);
  expect(downloads).toBe(1);
  corrupt = true;
  version = "0.0.2";
  await expect(installEngine(options)).rejects.toThrow("checksum");
  expect(await installedEngine()).toEqual(first);
  expect(readdirSync(root).some((n) => n.startsWith(".install-"))).toBe(false);
  corrupt = false;
  bytes = readFileSync("tests/fixtures/engine/traversal.nupkg");
  await expect(installEngine(options)).rejects.toThrow();
  expect(existsSync(join(root, "escape"))).toBe(false);
  expect(await installedEngine()).toEqual(first);
});

it("selects numerically ordered full releases and refuses unsafe metadata and paths", () => {
  const asset = {
    PackageId: "ZeroEngine",
    Type: "Full",
    FileName: "engine.nupkg",
    Size: 20,
    SHA256: "a".repeat(64),
  };
  expect(
    chooseRelease([
      { ...asset, Version: "0.0.9" },
      { ...asset, Version: "0.0.10" },
    ]).Version,
  ).toBe("0.0.10");
  expect(() => chooseRelease([{ ...asset, Version: "0.0.1", FileName: "../bad.nupkg" }])).toThrow();
  expect(() => containedPath("/install", "../escape")).toThrow();
  expect(() => containedPath("/install", "C:/escape")).toThrow();
  expect(platformChannel("darwin", "arm64")).toBe("osx");
  expect(platformChannel("linux", "x64")).toBe("linux");
  expect(() => platformChannel("linux", "arm64")).toThrow("No native release");
});
