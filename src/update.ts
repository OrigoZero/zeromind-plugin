import { fetch } from "undici";

/**
 * The running plugin version. **Keep in sync with `package.json` "version".**
 * The MCP server reports this, and the first-use update check compares it
 * against the latest version published to npm.
 */
export const VERSION = "0.5.2";

const PKG = "@origozero/zeromind";

const registryBase = (): string =>
  (process.env.ZEROMIND_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/+$/, "");

export type UpdateInfo = {
  current: string;
  latest?: string;
  update_available: boolean;
  /** How the user can update — only set when `update_available` is true. */
  how_to_update?: string;
};

/**
 * Numeric compare of dotted versions (`major.minor.patch`). Any pre-release /
 * build suffix is ignored — enough for an "is a newer release available?"
 * check. Returns >0 if `a` is newer than `b`, <0 if older, 0 if equal.
 */
export const compareVersions = (a: string, b: string): number => {
  const parse = (v: string): number[] =>
    v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
};

const UPDATE_HINT =
  "A newer ZeroMind release is available. Tell the user and ask if they want to update — " +
  "the MCP server (`npx @origozero/zeromind`) picks up the new version on the next IDE " +
  "restart in every client (Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Cline, " +
  "Continue, Windsurf, Zed, …), since `npx -y` resolves to the latest published version " +
  "(clear the npx cache if it lags). Claude Code users additionally update the bundled " +
  "skills via `/plugin` (update the `zeromind` plugin from the OrigoZero/zeromind-plugin " +
  "marketplace) and then restart. The agent cannot update on its own.";

const fetchLatest = async (): Promise<UpdateInfo> => {
  const current = VERSION;
  try {
    const res = await fetch(`${registryBase()}/${PKG}/latest`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { current, update_available: false };
    const body = (await res.json()) as { version?: string };
    const latest = body.version;
    if (!latest) return { current, update_available: false };
    const update_available = compareVersions(latest, current) > 0;
    return {
      current,
      latest,
      update_available,
      how_to_update: update_available ? UPDATE_HINT : undefined,
    };
  } catch {
    // Best-effort: offline / blocked registry must never break the plugin.
    return { current, update_available: false };
  }
};

let inflight: Promise<UpdateInfo> | undefined;

/** Test hook: forget the memoized result so the next call re-checks. */
export const resetUpdateCache = (): void => {
  inflight = undefined;
};

/**
 * Best-effort, single-flight per process: checks npm for a newer published
 * release and compares it to the running {@link VERSION}. Memoized so the
 * network round-trip happens at most once per server process ("first use in
 * this context"). Never throws — on any failure it reports
 * `update_available: false`.
 */
export const checkForUpdate = (): Promise<UpdateInfo> => {
  if (!inflight) inflight = fetchLatest();
  return inflight;
};
