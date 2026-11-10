import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, statfs, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { open as openZip, type Entry, type ZipFile } from "yauzl";
import { lock } from "proper-lockfile";
import { cacheDir } from "./config.js";
import { issuer } from "./zeromind-client.js";
import { checkedEndpoint } from "./cli-oauth.js";

type Asset = {
  PackageId: string;
  Version: string;
  Type: string;
  FileName: string;
  SHA256: string;
  Size: number;
};
export type EngineInstall = { binary: string; version: string; platform: string; sha256: string };
const MAX_PACKAGE = 1024 * 1024 * 1024;
const MAX_EXPANDED = 4 * MAX_PACKAGE;
export const engineRoot = () => resolve(process.env.ZERO_ENGINE_DIR ?? join(cacheDir(), "engines"));

export function platformChannel(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === "win32" && arch === "x64") return "win";
  if (platform === "linux" && arch === "x64") return "linux";
  if (platform === "darwin" && arch === "arm64") return "osx";
  throw new Error(
    `No native release is advertised for ${platform}/${arch}; use an existing engine session or --bin <executable>.`,
  );
}

export function chooseRelease(assets: Asset[], version?: string): Asset {
  const candidates = assets.filter(
    (a) => a.PackageId === "ZeroEngine" && a.Type === "Full" && (!version || a.Version === version),
  );
  for (const a of candidates) {
    if (
      !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(a.Version) ||
      !/^[A-Za-z0-9_.-]+\.nupkg$/.test(a.FileName) ||
      !/^[a-f0-9]{64}$/i.test(a.SHA256) ||
      !Number.isSafeInteger(a.Size) ||
      a.Size <= 0 ||
      a.Size > MAX_PACKAGE
    ) {
      throw new Error("Release metadata has an invalid version, filename, checksum or size");
    }
  }
  candidates.sort((a, b) => {
    const av = a.Version.split(".").map(Number),
      bv = b.Version.split(".").map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++)
      if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (bv[i] ?? 0) - (av[i] ?? 0);
    return 0;
  });
  if (!candidates[0])
    throw new Error(
      `No full engine package${version ? ` for version ${version}` : ""} is available`,
    );
  return candidates[0];
}

export function containedPath(root: string, name: string): string {
  if (name.includes("\\") || name.includes("\0") || /^[a-z]:/i.test(name) || isAbsolute(name))
    throw new Error(`Unsafe archive path: ${name}`);
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Unsafe archive path: ${name}`);
  return full;
}

async function unzip(archive: string, destination: string): Promise<string[]> {
  const zip = await new Promise<ZipFile>((resolveZip, reject) =>
    openZip(archive, { lazyEntries: true }, (error, file) =>
      error ? reject(error) : resolveZip(file!),
    ),
  );
  const files: string[] = [],
    links: Array<{ path: string; target: string }> = [];
  let expanded = 0,
    entries = 0;
  await new Promise<void>((done, reject) => {
    let ended = false;
    const fail = (error: unknown) => {
      if (!ended) {
        ended = true;
        zip.close();
        reject(error);
      }
    };
    zip.on("error", fail);
    zip.on("end", () => {
      ended = true;
      done();
    });
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        if (++entries > 20000 || (expanded += entry.uncompressedSize) > MAX_EXPANDED)
          throw new Error("Engine archive exceeds extraction limits");
        const path = containedPath(destination, entry.fileName.replace(/\/$/, ""));
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if (entry.fileName.endsWith("/")) {
          await mkdir(path, { recursive: true });
          zip.readEntry();
          return;
        }
        await mkdir(dirname(path), { recursive: true });
        const stream = await new Promise<Readable>((r, j) =>
          zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s!))),
        );
        if ((mode & 0o170000) === 0o120000) {
          if (entry.uncompressedSize > 4096) throw new Error("Archive symlink is too long");
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const target = Buffer.concat(chunks).toString("utf8");
          if (isAbsolute(target) || target.includes("\\") || /^[a-z]:/i.test(target))
            throw new Error("Archive symlink must be relative");
          containedPath(
            destination,
            relative(destination, resolve(dirname(path), target))
              .split(sep)
              .join("/"),
          );
          links.push({ path, target });
        } else {
          if (mode & 0o170000 && (mode & 0o170000) !== 0o100000)
            throw new Error("Archive carries an unsupported file type");
          await pipeline(
            stream,
            createWriteStream(path, { flags: "wx", mode: mode & 0o777 || 0o644 }),
          );
          files.push(path);
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
  // File extraction finishes before any link is created, keeping archive writes inside the new directory.
  for (const link of links) await symlink(link.target, link.path);
  return files;
}

export async function installedEngine(): Promise<EngineInstall | undefined> {
  try {
    const record = JSON.parse(
      await readFile(join(engineRoot(), "current.json"), "utf8"),
    ) as EngineInstall;
    if (existsSync(record.binary)) return record;
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function activate(root: string, record: EngineInstall): Promise<void> {
  const pending = join(root, `current-${randomUUID()}.json`);
  try {
    await writeFile(pending, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    await rename(pending, join(root, "current.json"));
  } finally {
    await rm(pending, { force: true });
  }
}

export async function installEngine(
  options: {
    version?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    log?: (line: string) => void;
  } = {},
): Promise<EngineInstall> {
  const log = options.log ?? ((s) => process.stderr.write(s + "\n"));
  const channel = platformChannel(options.platform, options.arch);
  const root = engineRoot();
  await mkdir(root, { recursive: true });
  const releaseLock = await lock(root, { stale: 120000, update: 10000 });
  const stage = join(root, `.install-${randomUUID()}`);
  try {
    const base = checkedEndpoint(`${issuer()}/engine/updates/`);
    const response = await fetch(new URL(`releases.${channel}.json`, base), {
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Engine release discovery failed (${response.status})`);
    const manifest = (await response.json()) as { Assets: Asset[] };
    if (!Array.isArray(manifest.Assets))
      throw new Error("Engine release manifest contains no assets");
    const asset = chooseRelease(manifest.Assets, options.version);
    const directory = join(
      root,
      `${channel}-${asset.Version}-${asset.SHA256.slice(0, 12).toLowerCase()}`,
    );
    const current = await installedEngine();
    if (
      current?.version === asset.Version &&
      current.platform === channel &&
      current.sha256.toLowerCase() === asset.SHA256.toLowerCase()
    ) {
      log(`Engine ${asset.Version} is installed.`);
      return current;
    }
    if (existsSync(directory)) {
      const recovered = JSON.parse(
        await readFile(join(directory, "zero-cli-install.json"), "utf8"),
      ) as EngineInstall;
      const binary = containedPath(
        directory,
        relative(directory, recovered.binary).split(sep).join("/"),
      );
      if (
        recovered.version !== asset.Version ||
        recovered.platform !== channel ||
        recovered.sha256.toLowerCase() !== asset.SHA256.toLowerCase() ||
        !existsSync(binary)
      ) {
        throw new Error(`The existing engine directory does not match its release: ${directory}`);
      }
      await activate(root, recovered);
      log(`Engine ${asset.Version} selected.`);
      return recovered;
    }
    const space = await statfs(root);
    if (space.bavail * space.bsize < asset.Size * 5)
      throw new Error(`Engine installation needs at least ${asset.Size * 5} free bytes at ${root}`);
    log(`Installing Zero ${asset.Version}: ${Math.ceil(asset.Size / 1048576)} MiB download.`);
    await mkdir(stage);
    const archive = join(stage, "package.nupkg"),
      payload = join(stage, "payload");
    await mkdir(payload);
    const download = await fetch(new URL(asset.FileName, base), {
      signal: AbortSignal.timeout(600000),
      redirect: "error",
    });
    if (!download.ok || !download.body)
      throw new Error(`Engine download failed (${download.status})`);
    let received = 0,
      last = -1;
    const digest = createHash("sha256");
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > asset.Size) {
          callback(new Error("Engine download exceeds its advertised size"));
          return;
        }
        digest.update(chunk);
        const step = Math.floor((received * 10) / asset.Size);
        if (step !== last) {
          log(`Download ${Math.min(step * 10, 100)}%`);
          last = step;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(download.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(archive, { flags: "wx" }),
    );
    if (
      received !== asset.Size ||
      digest.digest("hex").toLowerCase() !== asset.SHA256.toLowerCase()
    )
      throw new Error("Engine package checksum or size does not match the release");
    const files = await unzip(archive, payload);
    const matches = files.filter((p) =>
      channel === "win" ? /[\\/]native\.exe$/i.test(p) : /[\\/]native$/.test(p),
    );
    if (matches.length !== 1)
      throw new Error(
        `Engine package must contain exactly one native executable; found ${matches.length}`,
      );
    if (process.platform !== "win32") await chmod(matches[0], 0o755);
    const binaryRelative = relative(payload, matches[0]);
    const record: EngineInstall = {
      binary: join(directory, binaryRelative),
      version: asset.Version,
      platform: channel,
      sha256: asset.SHA256,
    };
    await writeFile(join(payload, "zero-cli-install.json"), JSON.stringify(record));
    // An existing version directory belongs to an earlier install and is preserved.
    if (existsSync(directory))
      throw new Error(
        `Engine version directory already exists: ${directory}. Select its executable with --bin or inspect the earlier installation.`,
      );
    await rename(payload, directory);
    await activate(root, record);
    log(`Engine ${asset.Version} is ready.`);
    return record;
  } finally {
    // stage is a fresh UUID directory made by this invocation under the selected engine root.
    await rm(stage, { recursive: true, force: true });
    await releaseLock();
  }
}

export async function runEngineCli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  const usage =
    "Usage: zero engine install [--version <version>] | status | doctor [--software-rendering] [--bin <path>]";
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage + "\n");
    return;
  }
  if (command === "doctor") {
    let softwareRendering = false;
    let bin: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--software-rendering") softwareRendering = true;
      else if (rest[i] === "--bin" && rest[i + 1] && !rest[i + 1].startsWith("--")) bin = rest[++i];
      else throw new Error(usage);
    }
    const { checkHeadlessRenderer, findEngine } = await import("./engine-launch.js");
    const binary = await findEngine(bin);
    if (!binary)
      throw new Error("No native engine found. Run zero engine install, then zero engine doctor.");
    const renderer = await checkHeadlessRenderer(binary, {
      world: "",
      headless: true,
      softwareRendering,
    });
    process.stdout.write(JSON.stringify({ binary, renderer }, null, 2) + "\n");
    return;
  }
  if (command === "status" && rest.length === 0) {
    process.stdout.write(
      JSON.stringify((await installedEngine()) ?? { installed: false }, null, 2) + "\n",
    );
    return;
  }
  if (
    command !== "install" ||
    (rest.length !== 0 && (rest.length !== 2 || rest[0] !== "--version"))
  ) {
    throw new Error(usage);
  }
  const result = await installEngine({ version: rest[1] });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
