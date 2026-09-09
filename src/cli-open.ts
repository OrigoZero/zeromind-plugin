// `zeromind open <world> [--play | --edit] [--native | --browser] [--dry-run]`
//
// The local hand for a world an agent found. Every harness reaches ZeroMind
// through the remote `/mcp`, and a server has no browser tab and no engine
// process on this machine: `world.open` / `world.launch` answer where a world
// opens, and this command is the step that opens it here.
//
// A guid or a URL is opened without a single network call. A name is resolved
// against `world.list` on `/mcp`, with the same credential every other command
// presents — never printed, and no engine is contacted at all.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, installSecret, loadCache } from "./config.js";
import { McpHttpClient } from "./mcp-client.js";
import { remoteUrl } from "./server-spec.js";
import { issuer } from "./zeromind-client.js";

/** Which face of the world opens: its editor, or the game as a player sees it. */
export type OpenMode = "edit" | "play";

/** Where it opens: the desktop engine through `zero://`, or a browser tab. */
export type OpenTarget = "native" | "browser";

/** The file that remembers the target, beside the machine's `session.json`. */
export const preferencePath = (): string => join(cacheDir(), "open.json");

/** Milliseconds a handler probe may take before the answer is "no handler". */
const HANDLER_PROBE_MS = 10_000;

/** macOS keeps its URL-scheme registrations here. */
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** A guid the URL builders will put in front of an OS shell. */
const SAFE_GUID = /^[A-Za-z0-9_.:-]+$/;

/** What a bare `wld_…` argument looks like, so it needs no `world.list` call. */
const GUID_ARGUMENT = /^wld_[A-Za-z0-9_.:-]+$/;

/** The `mode` the engine's `zero://` handler reads for each face. */
const NATIVE_MODE: Record<OpenMode, string> = { edit: "editor", play: "ref" };

/** The runtime profile that face boots. The native engine reads `profile` to
 *  pick its top-level config; without it a play deep-link boots the editor. */
const NATIVE_PROFILE: Record<OpenMode, string> = { edit: "editor", play: "runtime" };

/** The web route that serves each face. */
const BROWSER_ROUTE: Record<OpenMode, string> = { edit: "edit", play: "play" };

const checkedGuid = (guid: string): string => {
  if (!SAFE_GUID.test(guid)) throw new Error(`'${guid}' is not a world guid`);
  return guid;
};

/** Where the browser opens the world. */
export const browserUrl = (guid: string, mode: OpenMode, base = issuer()): string =>
  `${base.replace(/\/+$/, "")}/${BROWSER_ROUTE[mode]}/${checkedGuid(guid)}`;

/** The `zero://` URL the OS hands to the desktop engine. */
export const nativeUrl = (guid: string, mode: OpenMode): string =>
  `zero://launch?world=${encodeURIComponent(checkedGuid(guid))}&mode=${NATIVE_MODE[mode]}` +
  `&profile=${NATIVE_PROFILE[mode]}`;

/** What an argument turned out to name. A `mode` is present when the argument
 *  was a URL that already said which face it opens. */
export type WorldReference = { guid?: string; name?: string; mode?: OpenMode };

/**
 * Read a world out of the argument: a `zero://` URL, an `https://` engine URL,
 * a `wld_…` guid, or a name to resolve. A URL that names no world is an error
 * rather than a name, because a name it is not.
 */
export const parseWorldReference = (argument: string): WorldReference => {
  const raw = argument.trim();
  if (raw === "") throw new Error("a world guid, name, or URL is required");
  const scheme = raw.slice(0, raw.indexOf(":")).toLowerCase();
  if (scheme === "zero") {
    const url = new URL(raw);
    const guid = url.searchParams.get("world");
    if (!guid) throw new Error(`'${raw}' carries no world to open`);
    const mode = url.searchParams.get("mode");
    return { guid, mode: mode === "ref" ? "play" : mode === "editor" ? "edit" : undefined };
  }
  if (scheme === "http" || scheme === "https") {
    const url = new URL(raw);
    const [route, guid] = url.pathname.split("/").filter((part) => part !== "");
    if (!guid) throw new Error(`'${raw}' carries no world to open`);
    return { guid, mode: route === "play" ? "play" : route === "edit" ? "edit" : undefined };
  }
  if (GUID_ARGUMENT.test(raw)) return { guid: raw };
  return { name: raw };
};

/** How many of an account's worlds an error names before it points at the listing. */
const NAMES_IN_AN_ERROR = 10;

/** One world as `world.list` reports it. */
type ListedWorld = { guid?: string; name?: string };

/**
 * The guid of the world called `wanted`, from this machine's own worlds. A
 * guid matches as readily as a name, so a guid in a shape this CLI does not
 * recognise still resolves.
 */
export const resolveWorldName = async (
  wanted: string,
  client: { callTool: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }> },
): Promise<string> => {
  const listed = await client.callTool("world.list", {});
  if (listed.isError) throw new Error(`world.list: ${listed.text}`);
  let worlds: ListedWorld[];
  try {
    worlds = ((JSON.parse(listed.text) as { worlds?: ListedWorld[] }).worlds ?? []) as ListedWorld[];
  } catch {
    throw new Error(`world.list answered something other than a listing: ${listed.text}`);
  }
  const match = worlds.find((w) => w.name === wanted || w.guid === wanted);
  if (!match?.guid) {
    const known = worlds
      .map((w) => w.name ?? w.guid)
      .filter((n): n is string => typeof n === "string");
    if (known.length === 0) {
      throw new Error(`no world of yours is called '${wanted}'; this account owns none`);
    }
    // An account holds hundreds of worlds; a few of them name the shape of the
    // answer, and `world.list` is where the whole listing already lives.
    const shown = known.slice(0, NAMES_IN_AN_ERROR).join(", ");
    const rest = known.length - NAMES_IN_AN_ERROR;
    throw new Error(
      `no world of yours is called '${wanted}'; yours include ${shown}` +
        (rest > 0 ? ` and ${rest} more (world.list has them all)` : ""),
    );
  }
  return match.guid;
};

/** Whether this machine has a program registered for `zero://` URLs. */
export const hasNativeHandler = (): boolean => {
  const probe = (file: string, args: string[]): boolean => {
    const out = execFileSync(file, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: HANDLER_PROBE_MS,
    });
    return out.trim() !== "";
  };
  try {
    if (process.platform === "win32") {
      // The registration lives per-user or machine-wide, and either one means
      // the OS has something to hand the URL to.
      for (const root of ["HKCU", "HKLM"]) {
        try {
          if (probe("reg", ["query", `${root}\\Software\\Classes\\zero\\shell\\open\\command`])) {
            return true;
          }
        } catch {
          /* this root holds no such key */
        }
      }
      return false;
    }
    if (process.platform === "darwin") {
      // The dump is large and the match is near the top of a claim block; the
      // grep ends the read as soon as one scheme binding names `zero`.
      return probe("/bin/sh", ["-c", `${LSREGISTER} -dump | grep -m1 -i "bindings:.*zero:"`]);
    }
    return probe("xdg-mime", ["query", "default", "x-scheme-handler/zero"]);
  } catch {
    return false;
  }
};

/** Hand a URL to the platform's opener, detached, and let it outlive the CLI. */
export const openWithPlatform = async (url: string): Promise<void> => {
  // The Windows command line carries the URL inside quotes, so a quote, a
  // space or a control character in one would end that quoting. No URL this
  // composes holds any, and one typed as an argument is refused here.
  const printable = [...url].every((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f);
  if (!printable || /["\s]/.test(url)) throw new Error(`'${url}' is not a URL this can open`);
  const child =
    process.platform === "win32"
      ? // `start` is a `cmd` builtin, and the URL is quoted inside the command
        // line so `&` between query parameters stays part of it.
        spawn("cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], {
          detached: true,
          stdio: "ignore",
          windowsVerbatimArguments: true,
        })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
};

/** The target this machine last had named for it by a flag. */
export const loadPreference = (): OpenTarget | undefined => {
  const path = preferencePath();
  if (!existsSync(path)) return undefined;
  try {
    const target = (JSON.parse(readFileSync(path, "utf8")) as { target?: string }).target;
    return target === "native" || target === "browser" ? target : undefined;
  } catch {
    // A file this cannot read says nothing about the target, and the flags and
    // the handler probe still answer.
    return undefined;
  }
};

/** Remember the target a flag named, for the calls that pass no flag. */
export const savePreference = (target: OpenTarget): void => {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(preferencePath(), JSON.stringify({ target }, null, 2) + "\n", { encoding: "utf8" });
};

/** What the command was asked to do. */
export type OpenRequest = {
  world: string;
  mode?: OpenMode;
  target?: OpenTarget;
  dryRun?: boolean;
};

/** The machine and the network, as `openWorld` reaches them. */
export type OpenDependencies = {
  resolveWorld: (name: string) => Promise<string>;
  hasNativeHandler: () => boolean;
  open: (url: string) => Promise<void>;
  loadPreference: () => OpenTarget | undefined;
  savePreference: (target: OpenTarget) => void;
  browserBase: string;
  out: (line: string) => void;
};

/** What was opened, and where. */
export type OpenOutcome = { guid: string; mode: OpenMode; target: OpenTarget; url: string };

/**
 * Resolve the world, choose the target, and open it.
 *
 * A flag wins; else the target a flag last named for this machine; else the
 * OS, which is asked whether it has a `zero://` handler. The choice and its
 * reason are printed, then the URL. A dry run prints both and changes nothing
 * — neither the machine's preference nor a window.
 */
export const openWorld = async (
  request: OpenRequest,
  deps: OpenDependencies,
): Promise<OpenOutcome> => {
  const reference = parseWorldReference(request.world);
  const guid = reference.guid ?? (await deps.resolveWorld(reference.name!));
  const mode = request.mode ?? reference.mode ?? "edit";

  let target: OpenTarget;
  let why: string;
  if (request.target) {
    target = request.target;
    why = `--${request.target}`;
    if (!request.dryRun) deps.savePreference(target);
  } else {
    const preferred = deps.loadPreference();
    if (preferred) {
      target = preferred;
      why = `the target --${preferred} saved in ${preferencePath()}`;
    } else if (deps.hasNativeHandler()) {
      target = "native";
      why = "this machine has a zero:// handler";
    } else {
      target = "browser";
      why = "this machine has no zero:// handler";
    }
  }

  const url = target === "native" ? nativeUrl(guid, mode) : browserUrl(guid, mode, deps.browserBase);
  deps.out(`${mode} in the ${target} — ${why}`);
  if (request.dryRun) {
    deps.out(`Would open ${url}`);
    return { guid, mode, target, url };
  }
  try {
    await deps.open(url);
  } catch (e) {
    throw new Error(`could not open ${url}: ${(e as Error).message}`);
  }
  deps.out(`Opened ${url}`);
  return { guid, mode, target, url };
};

const HELP = `zeromind open <world guid | name | https url | zero:// url> [options]

Open a world on this machine: its editor by default, in the desktop engine when
this machine has a zero:// handler and in a browser tab when it does not.

  --edit        open the editor (the default)
  --play        open the world as a player sees it
  --native      open the desktop engine through zero://
  --browser     open a browser tab
  --dry-run     print the target and the URL, change nothing

--native / --browser is remembered in <config dir>/open.json and used by later
calls that pass neither. A name is resolved against your worlds; a guid or a
URL is opened without a call.
`;

/**
 * Parse the arguments and open the world.
 *
 * `deps` is what the command reaches the machine and the network through: the
 * caller may supply its own, and every one it does not is the real thing.
 */
export const runOpenCli = async (
  argv: string[],
  deps: Partial<OpenDependencies> = {},
): Promise<void> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  let world: string | undefined;
  let mode: OpenMode | undefined;
  let target: OpenTarget | undefined;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--edit" || arg === "--play") {
      const asked: OpenMode = arg === "--play" ? "play" : "edit";
      if (mode && mode !== asked) throw new Error("--edit and --play ask for different things");
      mode = asked;
    } else if (arg === "--native" || arg === "--browser") {
      const asked: OpenTarget = arg === "--native" ? "native" : "browser";
      if (target && target !== asked) {
        throw new Error("--native and --browser ask for different things");
      }
      target = asked;
    } else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}\n\n${HELP}`);
    else if (world === undefined) world = arg;
    else throw new Error(`unexpected argument: ${arg}\n\n${HELP}`);
  }
  if (!world) throw new Error(`a world guid, name, or URL is required\n\n${HELP}`);

  const out = deps.out ?? ((line: string) => process.stdout.write(line + "\n"));
  // A guid or a URL names the world already; only a name costs a call, and
  // only then is this machine's credential needed at all.
  let client: McpHttpClient | undefined;
  const resolveWorld =
    deps.resolveWorld ??
    (async (name: string) => {
      const secret = installSecret(loadCache());
      if (!secret) throw new Error("this machine is not linked; run `zeromind link` first");
      client = new McpHttpClient(remoteUrl(), secret);
      await client.initialize();
      return resolveWorldName(name, client);
    });
  try {
    await openWorld(
      { world, mode, target, dryRun },
      {
        resolveWorld,
        hasNativeHandler: deps.hasNativeHandler ?? hasNativeHandler,
        open: deps.open ?? openWithPlatform,
        loadPreference: deps.loadPreference ?? loadPreference,
        savePreference: deps.savePreference ?? savePreference,
        browserBase: deps.browserBase ?? issuer(),
        out,
      },
    );
  } finally {
    await client?.close();
  }
};
