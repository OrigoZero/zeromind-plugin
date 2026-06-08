// Host-filesystem → engine-VFS binary file (and folder) upload.
//
// `upload_file` reads bytes from a path on the machine running THIS MCP
// server (the user's machine, where the agent harness spawned the plugin)
// and writes them into the connected world's engine VFS. It is the missing
// leg of the existing `read_file` / `write_file` / `edit_file` trio: those
// operate on the engine VFS but require the caller to inline binary content
// as base64 in the tool-call JSON itself, which blows up the agent's context
// window for any non-trivial asset (an image, a GLB, an audio clip) and
// forces one tool call per file when populating a folder.
//
// With `upload_file` the bytes never enter the tool-call JSON — the plugin
// reads them straight off disk and forwards each file to the engine's
// `write_file` over the bridge as `content_b64`, which the engine writes
// verbatim (binary-safe). A single call can populate an entire asset folder
// (textures/, models/, …) preserving the relative tree layout.
//
// This tool is plugin-native because only the plugin process has
// host-filesystem access — the browser engine sees only the VFS.
//
// (There is intentionally no `download_file` counterpart: the only VFS-read
// path the plugin has is the bridge `read_file` RPC, which lossily decodes
// non-PNG binary as UTF-8 — a GLB would come back corrupted. A correct
// binary download would need a raw VFS byte endpoint the browser engine does
// not expose to the plugin, so we don't ship a half-working one.)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { EngineTools } from "./tools/engine.js";

/** Default upper bound on the total bytes moved by a single call (256 MiB).
 *  Applied across an entire folder upload, not per file. Comfortably larger
 *  than any reasonable single asset while still guarding against an
 *  accidental directory-wide blast. Override per call via `max_bytes`. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** Default upper bound on the file count in a folder upload (10 000).
 *  Plenty for any sane asset folder; prevents a runaway descent into an
 *  enormous tree. Override per call via `max_files`. Ignored for single
 *  files. */
export const DEFAULT_MAX_FILES = 10_000;

/** Sanity ceiling on recursion depth — guards against symlink loops or
 *  absurd nesting. Symlinks are not followed regardless. */
const MAX_DEPTH = 64;

export const UPLOAD_TOOL_DEF = {
  name: "upload_file",
  description:
    "Upload a file or folder from the LOCAL machine (where this MCP server runs — the user's computer) into the connected world's engine VFS, preserving binary content exactly. Reads `local_path` off disk and writes it under `vfs_path` inside the engine.\n\n" +
    "- If `local_path` is a regular file, its bytes are written verbatim to `vfs_path` (the destination file path, e.g. /source/textures/wall.png).\n" +
    "- If `local_path` is a directory, the whole tree is walked recursively and every regular file is uploaded; the layout is mirrored under `vfs_path` (local foo/bar/baz.png lands at <vfs_path>/foo/bar/baz.png). Symlinks and empty subdirectories are skipped.\n\n" +
    "Use this for assets that already exist on disk — images (PNG/JPG/…), 3D models (GLB/GLTF/OBJ), audio, fonts, binary blobs, whole asset packs. It avoids inlining base64 into the tool call (which would blow up the agent's context) and avoids one call per file for a folder. For short text files the agent is authoring itself, `write_file` is still simpler. Requires a connected world (world.connect first). Always overwrites existing destinations. A leading `~` in local_path expands to the home directory.",
  inputSchema: {
    type: "object",
    properties: {
      local_path: {
        type: "string",
        description:
          "Path on the local machine to read from — a file or a directory. Absolute paths are used as-is; a leading `~/` expands to the home directory; relative paths resolve against the plugin process's working directory.",
      },
      vfs_path: {
        type: "string",
        description:
          "Destination path inside the engine VFS (e.g. /source/models/car.glb). When local_path is a folder, this is the destination root and the local tree is mirrored beneath it.",
      },
      max_bytes: {
        type: "integer",
        minimum: 1,
        description: "Upper bound on total bytes transferred; the upload aborts if exceeded. Defaults to 256 MiB.",
      },
      max_files: {
        type: "integer",
        minimum: 1,
        description: "Upper bound on the number of files in a folder upload. Defaults to 10000. Ignored for single-file uploads.",
      },
    },
    required: ["local_path", "vfs_path"],
  },
} as const;

export interface UploadArgs {
  local_path: string;
  vfs_path: string;
  max_bytes?: number;
  max_files?: number;
}

export interface UploadResult {
  ok: true;
  uploaded: number;
  bytes: number;
  vfs_path: string;
  local_path: string;
  /** Per-file destinations for a folder upload (omitted for a single file). */
  files?: string[];
}

/** Expand a leading `~` / `~/…` to the user's home directory. Anything else
 *  is returned unchanged. */
const expandHome = (p: string): string => {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
};

/** Join a trimmed VFS root with a relative POSIX path. The engine VFS always
 *  uses forward slashes regardless of the host OS, so we never let a Windows
 *  backslash leak into the composed path. */
const joinVfs = (root: string, rel: string): string => {
  const base = root.replace(/\/+$/, "");
  const tail = rel.split(path.sep).join("/").replace(/^\/+/, "");
  return tail ? `${base}/${tail}` : base;
};

/** Recursively collect every regular file under `root`, returned as paths
 *  relative to `root` together with their size. Symlinks are not followed. */
const walkLocalFiles = async (
  root: string,
  maxFiles: number,
): Promise<Array<{ rel: string; size: number }>> => {
  const out: Array<{ rel: string; size: number }> = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) {
      throw new Error(`max recursion depth ${MAX_DEPTH} reached at '${dir}'`);
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      // Skip symlinks — surprising behaviour is worse than missing files.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push({ dir: abs, depth: depth + 1 });
        continue;
      }
      if (entry.isFile()) {
        const st = await fs.stat(abs);
        out.push({ rel: path.relative(root, abs), size: st.size });
        if (out.length > maxFiles) {
          throw new Error(`max_files=${maxFiles} exceeded while walking '${root}'`);
        }
      }
    }
  }
  return out;
};

/** Read a file and forward it to the engine `write_file` as base64. */
const uploadOne = async (
  engine: EngineTools,
  abs: string,
  vfsPath: string,
): Promise<number> => {
  const bytes = await fs.readFile(abs);
  await engine.write_file({ path: vfsPath, content_b64: bytes.toString("base64") });
  return bytes.length;
};

/**
 * Upload a file or folder from the host filesystem into the engine VFS.
 * Auto-detects file vs directory from `local_path`.
 */
export const uploadFile = async (
  engine: EngineTools,
  args: UploadArgs,
): Promise<UploadResult> => {
  if (!args || typeof args.local_path !== "string" || args.local_path === "") {
    throw new Error("upload_file: 'local_path' is required");
  }
  if (typeof args.vfs_path !== "string" || args.vfs_path === "") {
    throw new Error("upload_file: 'vfs_path' is required");
  }
  const maxBytes = args.max_bytes && args.max_bytes > 0 ? args.max_bytes : DEFAULT_MAX_BYTES;
  const maxFiles = args.max_files && args.max_files > 0 ? args.max_files : DEFAULT_MAX_FILES;

  const localPath = path.resolve(expandHome(args.local_path));

  let stat;
  try {
    stat = await fs.stat(localPath);
  } catch (e) {
    throw new Error(`upload_file: cannot read local_path '${localPath}': ${(e as Error).message}`);
  }

  // ── Single file ────────────────────────────────────────────────────────
  if (stat.isFile()) {
    if (stat.size > maxBytes) {
      throw new Error(
        `upload_file: '${localPath}' is ${stat.size} bytes, exceeds max_bytes=${maxBytes} (raise max_bytes to override)`,
      );
    }
    const bytes = await uploadOne(engine, localPath, args.vfs_path);
    return {
      ok: true,
      uploaded: 1,
      bytes,
      vfs_path: args.vfs_path,
      local_path: localPath,
    };
  }

  if (!stat.isDirectory()) {
    throw new Error(`upload_file: local_path '${localPath}' is neither a regular file nor a directory`);
  }

  // ── Folder ─────────────────────────────────────────────────────────────
  const entries = await walkLocalFiles(localPath, maxFiles);
  if (entries.length === 0) {
    return {
      ok: true,
      uploaded: 0,
      bytes: 0,
      vfs_path: args.vfs_path,
      local_path: localPath,
      files: [],
    };
  }

  // Pre-flight the total-byte budget so we fail before mutating the VFS at
  // all rather than half-way through a large tree.
  let projected = 0;
  for (const { rel, size } of entries) {
    projected += size;
    if (projected > maxBytes) {
      throw new Error(
        `upload_file: folder upload would exceed max_bytes=${maxBytes} (running total ${projected} at '${rel}'); raise max_bytes to override`,
      );
    }
  }

  let bytesSent = 0;
  let sent = 0;
  const written: string[] = [];
  for (const { rel } of entries) {
    const abs = path.join(localPath, rel);
    const dest = joinVfs(args.vfs_path, rel);
    try {
      bytesSent += await uploadOne(engine, abs, dest);
    } catch (e) {
      throw new Error(
        `upload_file: failed on '${abs}' → '${dest}' after ${sent} file(s)/${bytesSent} bytes: ${(e as Error).message}`,
      );
    }
    sent += 1;
    written.push(dest);
  }

  return {
    ok: true,
    uploaded: sent,
    bytes: bytesSent,
    vfs_path: args.vfs_path.replace(/\/+$/, ""),
    local_path: localPath,
    files: written,
  };
};
