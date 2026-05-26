import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const withTmpConfigDir = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "zeromind-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
