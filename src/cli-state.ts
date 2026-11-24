import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./config.js";

export const statePath = (name: string): string => join(cacheDir(), name);

export function readState<T>(name: string): T | undefined {
  try {
    return JSON.parse(readFileSync(statePath(name), "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export function saveState(name: string, value: unknown): void {
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  const temporary = statePath(`${name}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, statePath(name));
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* The original write error names the failure. */
    }
    throw error;
  }
}

/** Serialize credential rotation across CLI processes. */
export async function credentialLock<T>(work: () => Promise<T>): Promise<T> {
  // Loaded here: a command that never rotates credentials does not pay for the module.
  const { lock } = await import("proper-lockfile");
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  const started = Date.now();
  let release: () => Promise<void>;
  let announced = false;
  for (;;) {
    try {
      release = await lock(statePath("cli-credentials"), {
        realpath: false,
        stale: 30_000,
        update: 10_000,
        retries: 0,
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      if (Date.now() - started > 30_000)
        throw new Error("Another CLI authentication operation is active; retry when it finishes.");
      if (!announced && Date.now() - started > 2000) {
        process.stderr.write("Waiting for another Zero CLI authentication operation...\n");
        announced = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await work();
  } finally {
    await release();
  }
}

/** A named context is scoped to this installation and the MCP endpoint. */
export async function conversationId(endpoint: string, context?: string): Promise<string> {
  const name = context ?? process.env.ZERO_CONTEXT ?? process.env.CODEX_THREAD_ID;
  if (!name)
    throw new Error(
      "Choose an agent context with --context <name> or ZERO_CONTEXT; reuse it for subsequent commands.",
    );
  const path = statePath("cli-identity.json");
  const derive = (identity: { id: string }) =>
    `zero-cli:${createHash("sha256")
      .update(JSON.stringify([identity.id, endpoint, name]))
      .digest("hex")}`;
  // The identity file is written once and never changed, so an installation that has one needs no lock.
  try {
    const existing = JSON.parse(readFileSync(path, "utf8")) as { id?: unknown };
    if (typeof existing.id === "string" && existing.id) return derive({ id: existing.id });
  } catch {
    /* Absent, or being written by another process: the locked path below decides. */
  }
  return credentialLock(async () => {
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, JSON.stringify({ id: randomUUID() }), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    return derive(JSON.parse(readFileSync(path, "utf8")) as { id: string });
  });
}
