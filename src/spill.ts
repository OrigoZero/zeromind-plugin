// Spill oversized tool-result text to the OS temp dir so massive returns
// cost the agent a head preview + a file pointer instead of the full payload.
// Mirrors zero_proxy_mcp's spill (crates/zero_proxy_mcp/src/spill.rs): same
// 16 KB threshold, 2 KB preview, newest-50 / 7-day pruning.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SPILL_THRESHOLD = 16 * 1024;
const PREVIEW_CHARS = 2 * 1024;
const KEEP_NEWEST = 50;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

let seq = 0;

/**
 * Spill oversized tool-result text to `<tmpdir>/zeromind-mcp-returns/`;
 * return the preview + pointer, or the text unchanged when under the
 * threshold. On any disk trouble the full payload is returned untouched —
 * better verbose than lossy.
 */
export function spillLargeText(text: string, tool: string): string {
  if (text.length <= SPILL_THRESHOLD) return text;
  const dir = path.join(os.tmpdir(), "zeromind-mcp-returns");
  try {
    fs.mkdirSync(dir, { recursive: true });
    prune(dir);
    const file = path.join(dir, `${tool}-${Date.now()}-${seq++}.txt`);
    fs.writeFileSync(file, text, "utf8");
    const kb = Math.round(text.length / 1024);
    return `${text.slice(0, PREVIEW_CHARS)}\n\n[output truncated — full ${kb} KB saved to ${file}; read the file if you need the rest]`;
  } catch {
    return text;
  }
}

function prune(dir: string): void {
  const now = Date.now();
  const files = fs
    .readdirSync(dir)
    .map((n) => {
      const p = path.join(dir, n);
      return { p, t: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.t - a.t);
  files.forEach((f, i) => {
    // i + 1: the file about to be written takes one of the slots.
    if (i + 1 >= KEEP_NEWEST || now - f.t > MAX_AGE_MS) {
      try {
        fs.unlinkSync(f.p);
      } catch {
        // best effort
      }
    }
  });
}
