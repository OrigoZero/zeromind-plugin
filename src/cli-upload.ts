// `zeromind upload <path> --world <name-or-guid> [--to <vfs dir>]`
//
// Copies bytes from this machine into a world's engine VFS: one file, or a
// folder whose relative layout is preserved under the destination. The bytes
// go from disk to `write_file` as base64, so a whole asset pack moves without
// ever passing through an agent's context window.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { installSecret, loadCache } from "./config.js";
import { McpHttpClient } from "./mcp-client.js";
import { remoteUrl } from "./server-spec.js";

/** Total bytes one upload may move (256 MiB), across a whole folder. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
/** Files one folder upload may carry. */
export const DEFAULT_MAX_FILES = 10_000;
/** Recursion ceiling — the guard against absurd nesting. Symlinks are skipped. */
const MAX_DEPTH = 64;
/** Where a file lands when `--to` is not given. */
export const DEFAULT_VFS_DIR = "/source";

/** Only the part of the client an upload uses, so a test can drive it. */
export type ToolCaller = {
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
};

export type UploadOptions = {
  client: ToolCaller;
  localPath: string;
  world: string;
  to?: string;
  maxBytes?: number;
  maxFiles?: number;
  out: (line: string) => void;
};

export type UploadResult = { uploaded: number; bytes: number; files: string[] };

/** Expand a leading `~` to the user's home directory. */
const expandHome = (p: string): string =>
  p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? join(homedir(), p.slice(1)) : p;

/** The engine VFS is always forward-slashed, whatever this host uses. */
const joinVfs = (dir: string, rel: string): string => {
  const base = dir.replace(/\/+$/, "");
  const tail = rel.split(sep).join("/").replace(/^\/+/, "");
  return tail ? `${base}/${tail}` : base;
};

/** Every regular file under `root`, relative to it, with its size. Symlinks
 *  are skipped, so a symlink loop cannot walk forever. */
const walk = async (root: string, maxFiles: number): Promise<Array<{ rel: string; size: number }>> => {
  const found: Array<{ rel: string; size: number }> = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) throw new Error(`'${dir}' is nested deeper than ${MAX_DEPTH} directories`);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push({ dir: abs, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      found.push({ rel: relative(root, abs), size: (await fs.stat(abs)).size });
      if (found.length > maxFiles) {
        throw new Error(
          `'${root}' holds more than max-files=${maxFiles} files; raise --max-files to upload it`,
        );
      }
    }
  }
  return found;
};

/**
 * Connect to `world`, then write every file under `localPath` into its VFS.
 * Nothing is written until the whole tree fits both ceilings, so an upload
 * that would exceed one leaves the world untouched.
 */
export const uploadToWorld = async (opts: UploadOptions): Promise<UploadResult> => {
  const maxBytes = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const maxFiles = opts.maxFiles && opts.maxFiles > 0 ? opts.maxFiles : DEFAULT_MAX_FILES;
  const to = opts.to && opts.to !== "" ? opts.to : DEFAULT_VFS_DIR;
  const localPath = resolve(expandHome(opts.localPath));

  let stat;
  try {
    stat = await fs.stat(localPath);
  } catch (e) {
    throw new Error(`cannot read '${localPath}': ${(e as Error).message}`);
  }

  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`'${localPath}' is neither a regular file nor a directory`);
  }
  const entries = stat.isDirectory()
    ? await walk(localPath, maxFiles)
    : [{ rel: relative(join(localPath, ".."), localPath), size: stat.size }];

  let projected = 0;
  for (const { rel, size } of entries) {
    projected += size;
    if (projected > maxBytes) {
      throw new Error(
        `this upload would move ${projected} bytes, past max-bytes=${maxBytes} (at '${rel}'); raise --max-bytes to upload it`,
      );
    }
  }

  const connected = await opts.client.callTool("world.connect", { world: opts.world });
  if (connected.isError) throw new Error(connected.text);

  const root = stat.isDirectory() ? localPath : join(localPath, "..");
  const files: string[] = [];
  let bytes = 0;
  for (const { rel } of entries) {
    const dest = joinVfs(to, rel);
    const content = await fs.readFile(join(root, rel));
    const wrote = await opts.client.callTool("write_file", {
      path: dest,
      content_b64: content.toString("base64"),
    });
    if (wrote.isError) {
      throw new Error(`'${dest}' after ${files.length} file(s): ${wrote.text}`);
    }
    bytes += content.length;
    files.push(dest);
    opts.out(dest);
  }
  opts.out(`${files.length} file(s), ${bytes} bytes -> ${to}`);
  return { uploaded: files.length, bytes, files };
};

const HELP = `zeromind upload <path> --world <name-or-guid> [--to <vfs dir>]

Copy a file, or a folder with its layout preserved, into the world's engine
VFS. --to defaults to ${DEFAULT_VFS_DIR}. Ceilings: --max-bytes (${DEFAULT_MAX_BYTES}) and
--max-files (${DEFAULT_MAX_FILES}); both are checked before anything is written.
`;

export const runUploadCli = async (argv: string[]): Promise<void> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  let localPath: string | undefined;
  let world: string | undefined;
  let to: string | undefined;
  let maxBytes: number | undefined;
  let maxFiles: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--world") world = argv[++i];
    else if (arg === "--to") to = argv[++i];
    else if (arg === "--max-bytes") maxBytes = Number(argv[++i]);
    else if (arg === "--max-files") maxFiles = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}\n\n${HELP}`);
    else if (localPath === undefined) localPath = arg;
    else throw new Error(`unexpected argument: ${arg}\n\n${HELP}`);
  }
  if (!localPath) throw new Error(`a path to upload is required\n\n${HELP}`);
  if (!world) throw new Error(`--world <name-or-guid> is required\n\n${HELP}`);

  const secret = installSecret(loadCache());
  if (!secret) throw new Error("this machine is not linked; run `zeromind link` first");
  const client = new McpHttpClient(remoteUrl(), secret);
  try {
    await client.initialize();
    await uploadToWorld({
      client,
      localPath,
      world,
      to,
      maxBytes,
      maxFiles,
      out: (line) => process.stdout.write(line + "\n"),
    });
  } finally {
    await client.close();
  }
};
