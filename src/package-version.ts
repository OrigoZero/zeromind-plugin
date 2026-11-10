import { readFileSync } from "node:fs";

/** Package version used by CLI output and API client identification. */
export const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
