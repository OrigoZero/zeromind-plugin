# @origozero/zeromind

`@origozero/zeromind` is two things: a **declaration of the remote ZeroMind MCP server** (`https://origozero.ai/mcp`) written into your agent harness's own config, and the **skills** that teach the agent to check ZeroMind before it builds anything. Nothing runs on your machine — the CLI links the machine to your ZeroMind account, writes the server entry, and exits. Every tool the agent then calls (ZeroMind content discovery, worlds, and the engine of the world you have open) is served by ZeroMind over HTTPS, so a new tool is available the moment ZeroMind ships it, with nothing to upgrade here.

Each supported harness (Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode, Cline, Continue, Windsurf, Zed, openClaw, JetBrains Junie, Sourcegraph Amp, GitHub Copilot, Block Goose, Aider) gets its onboarding through that harness's own native channel — skills, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, `.clinerules`, `CONVENTIONS.md`, `.goosehints` — plus the MCP entry in the config file that harness reads. A harness with no custom-crafted integration uses the generic streamable-HTTP wiring in [`ide/README.md`](ide/README.md#generic-mcp-fallback).

What the agent gets, once linked: the ZeroMind library (search, inspect, preview, install, engage), worlds (list, create, fork, launch, connect, and the reversible delete / trash / restore), and — for the world it is connected to — the engine itself (`execute`, `guides`, `capture`, the VFS, `bash`). `tools/list` on `https://origozero.ai/mcp` is the current surface; it is served rather than shipped, so this README does not enumerate it.

## Prerequisites

**Node.js 18 or newer**, on your PATH, to run `zeromind link`, `zeromind install`, `zeromind upload` and `zeromind open`. Your harness then talks to `https://origozero.ai/mcp` over HTTPS and spawns nothing locally.

- **macOS:** `brew install node` (or download from https://nodejs.org)
- **Linux:** your distro's package manager, or https://nodejs.org / [nvm](https://github.com/nvm-sh/nvm)
- **Windows:** https://nodejs.org (LTS installer) — restart your IDE after install so it picks up the new PATH

Verify with `node --version`.

## Install

### Claude Code

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
npx -y @origozero/zeromind link
```

The bundle carries the skills and an `.mcp.json` whose `Authorization` header expands `${ZEROMIND_INSTALL_SECRET}`; `zeromind link` writes that variable into `~/.claude/settings.json` `env`. Restart Claude Code afterwards so the new setting is read.

### Every other harness

```
npx -y @origozero/zeromind install <harness>
```

One command per harness — it links the machine first if it isn't linked yet, writes the harness's native instruction file, and writes the `/mcp` entry into that harness's own MCP config:

```
npx -y @origozero/zeromind install claude       # .claude/skills/zeromind-{getting-started,library}/SKILL.md
npx -y @origozero/zeromind install cursor       # .cursor/rules/zeromind.mdc
npx -y @origozero/zeromind install codex        # ~/.codex/AGENTS.md (or ./AGENTS.md)
npx -y @origozero/zeromind install gemini       # ~/.gemini/GEMINI.md (or ./GEMINI.md)
npx -y @origozero/zeromind install opencode     # .opencode/skills/zeromind/SKILL.md
npx -y @origozero/zeromind install cline        # .clinerules/zeromind.md
npx -y @origozero/zeromind install continue     # .continue/rules/zeromind.md
npx -y @origozero/zeromind install windsurf     # ./AGENTS.md
npx -y @origozero/zeromind install zed          # .claude/skills/zeromind/SKILL.md
npx -y @origozero/zeromind install openclaw     # skills/zeromind/SKILL.md
npx -y @origozero/zeromind install junie        # ./AGENTS.md
npx -y @origozero/zeromind install amp          # ./AGENT.md
npx -y @origozero/zeromind install copilot      # .github/copilot-instructions.md
npx -y @origozero/zeromind install goose        # ~/.config/goose/.goosehints
npx -y @origozero/zeromind install aider        # ./CONVENTIONS.md
npx -y @origozero/zeromind install hermes       # ~/.hermes/config.yaml + plugin bundle

npx -y @origozero/zeromind install --list       # enumerate
```

Every command is idempotent: shared files (`AGENTS.md`, `GEMINI.md`, `CONVENTIONS.md`, `.goosehints`, `copilot-instructions.md`) carry a delimited `<!-- BEGIN ZEROMIND -->` block that is replaced in place; owned files (skills, rule files) need `--force` to overwrite. Two harnesses have no MCP config path to write into — openClaw's is unconfirmed, and Aider takes servers on the command line — so the install prints their entry for you to paste. [`ide/README.md`](ide/README.md) has the full table, with a README per harness.

## Linking

A machine links **once**, and the link is the same one the Zero engine uses: both read and write `session.json` in the OS config dir (`~/.config/zero/session.json`; `%APPDATA%\zero\session.json` on Windows; mode 0600 off Windows). Linking from either side links both, and unlinking revokes every harness on the machine at once.

```
npx -y @origozero/zeromind link                       # device code, approved in the browser
npx -y @origozero/zeromind link --username <handle>   # pre-fill the approval page's agent name
npx -y @origozero/zeromind status                     # what this machine is linked as
npx -y @origozero/zeromind unlink                     # revoke it
```

`link` registers this machine as its own ZeroMind principal, prints a URL and a code, and waits for you to approve it on that page. The approved account is the agent's identity — its own ZeroMind account, distinct from yours.

On a machine that already holds an approved install — linked by an earlier run, or by the Zero engine, which writes the same file — `link` prints who the machine acts as, asks for no new code, and still hands the secret to Claude Code. One linked install per machine is the whole rule; `unlink`, then `link`, is how a machine changes which account it acts as.

`unlink` revokes the install at ZeroMind and removes it from this machine's cache — the install fields only, so a session the Zero engine signed in with, and the issuer it signed in against, stay where they are. If ZeroMind answers that it holds no such install, the local clear happens anyway; if the revoke cannot be made at all, nothing is cleared and the command tells you to run it again once ZeroMind is reachable.

`unlink` also takes `ZEROMIND_INSTALL_SECRET` back out of `~/.claude/settings.json` when it holds the secret being revoked — before it revokes anything, so a settings file it cannot read is reported and the unlink still completes. (That one line is then yours to delete.) The entries `install <harness>` wrote into other harnesses keep the revoked secret and answer `401` until you link again and re-run the install for that harness — the command says so when it runs.

The credential a harness presents is that install's secret, sent as `Authorization: Bearer ins_sec_…`. **A `401` / `invalid_token` from any tool means the machine is not linked** (or the entry holds a stale secret): run `link`, re-run `install <harness>` so the entry is rewritten, and restart the harness.

## Uploading local files into a world

```
npx -y @origozero/zeromind upload <path> --world <name-or-guid> [--to <vfs dir>]
```

Copies a file — or a folder, its relative layout preserved — from this machine into the world's engine VFS, under `/source` unless `--to` says otherwise. The bytes go from disk to the world's `write_file` as base64, so an asset pack never passes through an agent's context window. Ceilings of 256 MiB and 10 000 files are checked before anything is written (`--max-bytes` / `--max-files` raise them), and a world with no engine running is reported rather than half-written.

## Opening a world on this machine

```
npx -y @origozero/zeromind open <world guid | name | https url | zero:// url> [--play | --edit] [--native | --browser] [--dry-run]
```

Every tool an agent calls is served by ZeroMind, which has no browser tab and no engine process on your machine: `world.open` and `world.launch` answer **where** a world opens, and this command is what opens it **here**. It opens the world's editor by default and the player's face with `--play`; it hands the URL to the desktop engine when this machine has a `zero://` handler registered and to a browser tab when it does not. `--native` / `--browser` decide it outright and are remembered in `open.json` beside `session.json`, so later calls with neither flag follow what you chose. `--dry-run` prints the target and the URL and changes nothing.

A guid or a URL is opened without a single network call. A name is resolved against your own worlds over `/mcp`, with this machine's install secret — which is never printed. No engine is contacted at all.

## Pointing at a local / self-hosted ZeroMind

Two environment variables move the whole CLI to another backend:

| Variable | Default | What it controls |
|---|---|---|
| `ZEROMIND_ISSUER` | `https://origozero.ai` | Base for every REST call (`/v1/installs/*`, `/v1/worlds`, …) **and** the `/mcp` URL written into a harness's config. Also the origin of the `/link` approval page. |
| `ZEROMIND_CONFIG_DIR` | `~/.config/zero` (XDG; `%APPDATA%\zero` on Windows) | Where `session.json` — the `install_id` / `install_secret` this machine shares with the Zero engine — lives. Point it elsewhere (e.g. `~/.config/zero-local`) so a local backend gets a **fresh install identity** instead of replaying credentials registered against production. |

For the local ZeroMind dev stack, point the issuer at the **front door** (`http://127.0.0.1:3003`), not the bare API on `:3001` — the front door serves the `/v1` REST surface, `/mcp`, and the web app (including `/link` and the `/edit/<guid>` engine pages) on one origin, which is what the CLI assumes.

```bash
ZEROMIND_ISSUER=http://127.0.0.1:3003 \
ZEROMIND_CONFIG_DIR=$HOME/.config/zero-local \
  npx -y @origozero/zeromind link

ZEROMIND_ISSUER=http://127.0.0.1:3003 \
ZEROMIND_CONFIG_DIR=$HOME/.config/zero-local \
  npx -y @origozero/zeromind install claude
```

The entry that lands is the production shape at the local address:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "zeromind": {
      "type": "http",
      "url": "http://127.0.0.1:3003/mcp",
      "headers": {
        "Authorization": "Bearer ins_sec_...",
        "X-ZM-Harness": "claude-code"
      }
    }
  }
}
```

Or with the Claude Code CLI:

```bash
claude mcp add --transport http zeromind http://127.0.0.1:3003/mcp \
  --header "Authorization: Bearer ins_sec_..." \
  --header "X-ZM-Harness: claude-code"
```

Plain `http://` issuers work end to end: auth is a Bearer header on every request, with no cookies and no TLS-only assumption.

## Updating

- **The tools** are served from `https://origozero.ai/mcp`. Every harness reaches the running version; there is nothing to upgrade on your machine.
- **The artifacts `zeromind install <harness>` wrote** — instruction blocks, skills, the MCP entry — refresh by re-running the install command.
- **The Claude Code bundle** (skills + `.mcp.json`) updates through `/plugin`.

Maintainers: `package.json` `version` is the source of truth — keep `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in lockstep with it.

## Status

0.7.1 — the plugin runs no MCP server of its own. It links a machine, writes the remote `/mcp` entry into sixteen harnesses, uploads local files into a world, opens a world on this machine, and ships the two skills. The tool surface is ZeroMind's, served live at `https://origozero.ai/mcp`; the tests drive the CLI end to end against the bundled mock ZeroMind server in [`tools/mock-zeromind/`](tools/mock-zeromind/).

This release needs a Zero engine that keeps `install_secret` in the shared `session.json` it writes: an engine whose cached-session struct has no such field re-serialises the file without it, and the machine reads as unlinked the next time the CLI runs. 0.7.1 therefore ships after that engine release.

## Development

```bash
npm install
npm test          # builds, then runs the suite against the bundled mock ZeroMind server
npm run build     # compile TypeScript
npm run lint
```

The canonical agent operating manual lives in [`templates/manual.md`](templates/manual.md); every per-harness installer wraps that one file with the harness's expected frontmatter. Adding a harness is one entry in [`src/cli-install.ts`](src/cli-install.ts) plus an `ide/<harness>/README.md`.

## Releasing

1. Bump `version` in `package.json` (and the two `.claude-plugin` manifests).
2. `git tag vX.Y.Z && git push --tags` — the publish workflow runs.

Requires the `NPM_TOKEN` secret in repo settings, scoped to the `@origozero` npm org.

## License

MIT
