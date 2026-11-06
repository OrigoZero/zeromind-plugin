# @origozero/zeromind

`@origozero/zeromind` connects your agent to ZeroMind through its shell or its MCP integration. The `zero` and `zeromind` commands call the hosted server at `https://origozero.ai/mcp`, which authenticates the caller and routes operations to the selected engine. Worlds, branches, files, and shell execution live in that engine, whether it runs in a browser, on this computer, or elsewhere. The package also installs harness configuration and the skills that teach agents to use ZeroMind.

## Use your agent's shell

Install the CLI and approve its browser sign-in once:

```sh
npm install -g @origozero/zeromind
zero login
```

In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.
From a built source checkout, invoke `node dist/index.js` in place of `zero`,
and `node dist/shell.js` in place of `zero-shell`:

```sh
node dist/index.js --help
node dist/index.js --context my-agent sessions
```

Use a distinct context name for each agent. Reuse that name across commands:

```sh
zero --context my-agent sessions
zero --context my-agent connect --world "My World" --branch feature
zero --context my-agent bash -c 'pwd; ls /zero/source'
zero --context my-agent bash -c 'zm status'
```

`sessions` names each engine, its world and branch. When several engines match,
select one explicitly with `connect --session <id>`. The hosted service owns
selection and permissions; the context preserves the caller identity and engine
pin between CLI processes. A disappeared engine is reported by the server.
Release the context's connection when finished with `zero --context my-agent disconnect`.

Set `ZERO_CONTEXT` to omit `--context`. Codex's `CODEX_THREAD_ID` is used when
present and no explicit context was supplied. Different contexts keep separate
shell directories, variables and selected engines. `zero tools` returns the
hosted tool catalogue and schemas; `zero call` reaches every operation it lists:

```sh
zero --context my-agent tools
zero --context my-agent call world.list
zero --context my-agent call read_file --input '{"path":"/zero/source/main.luau"}'
```

Generic calls print the MCP content blocks and structured content as JSON,
including images and other non-text results. `bash -c` instead writes the engine
shell's stdout and stderr to the corresponding host streams and returns its exit
status. The CLI uses the engine's shell API through hosted `execute` to retain
those fields, and follows promoted work with hosted `wait`. `bash -s` reads a
shell script from host stdin:

```sh
printf 'pwd\nls /zero/source\n' | zero --context my-agent bash -s
```

For a harness that accepts a custom shell executable, choose `zero-shell`, set
`ZERO_CONTEXT` to the context connected above, and disable login-shell mode. Its
ordinary `-c` calls then execute in the selected engine:

```sh
ZERO_CONTEXT=my-agent zero-shell -c 'pwd; ls /zero/source'
```

The adapter accepts `-c <command>` and `-s` (a script on stdin). Interactive TTY
attachment, streaming command stdin, and remote cancellation require an adapter
to those engine facilities. The existing `open` command opens the local browser or native handler and
reports that handoff; use `sessions` and `connect` to select the ready engine.

OAuth requests `read write` by default. To publish, authorize the corresponding
scope with `zero login --scope 'read write publish'`. Tokens refresh automatically
and are stored separately from the engine's machine-link cache. `zero logout`
revokes the CLI's OAuth tokens. Existing `/link` credentials also work with these
commands. The open and upload commands reuse OAuth sign-in when present.

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

Maintainers: `package.json` `version` is the source of truth. `tests/directory-manifests.test.ts` fails when a manifest it names carries a different one.

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

### Directory manifests

Four plugin directories read a manifest from the root of this repository:

| Directory | Root file | What it loads |
|---|---|---|
| Claude Code marketplace | `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json` | `skills/`, `.mcp.json` |
| Gemini CLI extensions gallery | `gemini-extension.json` | `skills/`, `templates/manual.md` as the context file |
| Codex plugins | `.codex-plugin/plugin.json` | `skills/`, `dist-publishing/codex-plugin/.mcp.json` |
| Cursor Marketplace | `.cursor-plugin/marketplace.json` | the bundle in `dist-publishing/cursor-plugin/` |

Nothing generates these files or the bundles under [`dist-publishing/`](dist-publishing/README.md). `tests/directory-manifests.test.ts` runs in CI and fails when a root manifest and its bundle disagree, when a path one of them names does not resolve, or when a bundle's copy of `skills/` differs from the original.

## Releasing

1. Bump `version` in `package.json` and in every manifest `tests/directory-manifests.test.ts` checks against it.
2. `git tag vX.Y.Z && git push --tags` — the publish workflow runs.

Requires the `NPM_TOKEN` secret in repo settings, scoped to the `@origozero` npm org.

## Security

[SECURITY.md](SECURITY.md) says how to report a vulnerability.

## License

MIT. See [LICENSE](LICENSE).
