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

describe("skill content: zeromind.search examples", () => {
  it("never passes the retired `kind` parameter to zeromind.search (assetType replaced it)", () => {
    for (const rel of SKILL_FILES) {
      const path = join(process.cwd(), rel);
      const text = readFileSync(path, "utf8");
      // A line naming a zeromind.search call that also carries a bare `kind:`
      // (quoted or not) is the retired filter — `top_by_kind` and other
      // identifiers keep `kind` glued to a neighbour, so \b keeps them out.
      const offenders = text
        .split("\n")
        .filter((line) => /zeromind\.search/.test(line) && /\bkind\s*:/.test(line));
      expect(
        offenders,
        `${rel} still passes "kind" to zeromind.search — use "assetType":\n${offenders.join("\n")}`,
      ).toEqual([]);
    }
  });
});
