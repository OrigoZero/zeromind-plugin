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
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  const path = statePath("cli-auth.lock");
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (Date.now() >= deadline)
        throw new Error(
          `Authentication is busy; retry after the other login finishes. Lock: ${path}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await work();
  } finally {
    unlinkSync(path);
  }
}

/** A named context is scoped to this installation and the MCP endpoint. */
export async function conversationId(endpoint: string, context?: string): Promise<string> {
  const name = context ?? process.env.ZERO_CONTEXT ?? process.env.CODEX_THREAD_ID;
  if (!name)
    throw new Error(
      "Choose an agent context with --context <name> or ZERO_CONTEXT; reuse it for subsequent commands.",
    );
  return credentialLock(async () => {
    mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
    const path = statePath("cli-identity.json");
    try {
      writeFileSync(path, JSON.stringify({ id: randomUUID() }), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const identity = JSON.parse(readFileSync(path, "utf8")) as { id: string };
    return `zero-cli:${createHash("sha256")
      .update(JSON.stringify([identity.id, endpoint, name]))
      .digest("hex")}`;
  });
}
