import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The shipped skills — the same `skills/` tree `installHarness` copies onto
 *  a harness's disk. Checked from source rather than a fresh install output,
 *  since every harness reads this exact text unmodified. */
const SKILL_FILES = [
  "skills/zeromind-getting-started/SKILL.md",
  "skills/zeromind-library/SKILL.md",
];

/** A `zeromind.search` call's argument object, wherever it starts — a single
 *  fenced-code line or a call spread over several. Scans from the opening
 *  `{` and tracks string state so a quoted value's own brace can't end the
 *  span early, stopping at the brace that actually closes the call. */
const extractBraceSpan = (text: string, openIndex: number): string => {
  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++; // an escaped quote/backslash never ends the string
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex); // unterminated call: take the rest, still checkable
};

const CALL_START = /zeromind\.search\s*\(?\s*\{/g;

// Matches `kind` as an object key — bare (`kind:`) or JSON-quoted
// (`"kind":` / `'kind':`), optionally spaced or line-broken before the
// colon. The `\b` on both sides of the bare word keeps `top_by_kind` and
// any similar identifier out: the underscore before "kind" is a word
// character, so no boundary forms there and the key form never matches it.
const KIND_KEY = /["']?\bkind\b["']?\s*:/;

/** Every `zeromind.search { ... }` call in `text` whose argument object
 *  still carries the retired `kind` filter, same line or spread over
 *  several. */
const findOffendingCalls = (rel: string, text: string): string[] => {
  const offenders: string[] = [];
  CALL_START.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_START.exec(text))) {
    const openIndex = match.index + match[0].length - 1;
    const span = extractBraceSpan(text, openIndex);
    if (KIND_KEY.test(span)) {
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${rel}:${line}: ${span.replace(/\s+/g, " ").trim()}`);
    }
  }
  return offenders;
};

describe("skill content: zeromind.search examples", () => {
  it("never passes the retired `kind` parameter to zeromind.search, on one line or spread over several (assetType replaced it)", () => {
    const offenders = SKILL_FILES.flatMap((rel) =>
      findOffendingCalls(rel, readFileSync(join(process.cwd(), rel), "utf8")),
    );
    expect(
      offenders,
      `still passing "kind" to zeromind.search — use "assetType":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
