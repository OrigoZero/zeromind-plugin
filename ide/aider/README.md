# ZeroMind for Aider

[Aider](https://aider.chat/) is a CLI pair-programmer.

**Native channel:** `CONVENTIONS.md` — loaded into every request via `aider --read CONVENTIONS.md` or `.aider.conf.yml`.

## Heads-up: MCP goes on the command line

Aider takes MCP servers as JSON on the command line, and an Aider that predates `--mcp-servers` errors on an unknown key in `.aider.conf.yml` (see [aider-ai/aider#4506](https://github.com/aider-ai/aider/issues/4506)) — so `zeromind install aider` prints this rather than writing it:

```
aider --mcp-servers '{"mcpServers":{"zeromind":{"url":"https://origozero.ai/mcp","headers":{"Authorization":"Bearer ins_sec_...","X-ZM-Harness":"aider"}}}}'
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows) — run `npx -y @origozero/zeromind link` first if there isn't one. Paste it into the command yourself; Aider takes MCP servers on the command line, so there is no config file for the install to write.

Without that flag only the operating manual reaches the agent — the `zeromind.*` tools are not callable. If you want them, pair Aider with a separate MCP-capable agent for the engine work, or use one of the other harnesses listed in [`../README.md`](../README.md).

## Install

```
npx @origozero/zeromind install aider   # appends a ZeroMind block to ./CONVENTIONS.md
```

Re-running is idempotent — it replaces the existing ZeroMind block.

Then tell Aider to read it. Either:

```
aider --read CONVENTIONS.md
```

…or add to `.aider.conf.yml`:

```yaml
read:
  - CONVENTIONS.md
```

Aider includes every line of CONVENTIONS.md in every request — keep the file lean. The canonical ZeroMind manual is already ~80 lines; if your project's CONVENTIONS.md is approaching Aider's recommended ~200-line ceiling, edit the ZeroMind block down.
