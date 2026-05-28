# ZeroMind for Aider

[Aider](https://aider.chat/) is a CLI pair-programmer.

**Native channel:** `CONVENTIONS.md` — loaded into every request via `aider --read CONVENTIONS.md` or `.aider.conf.yml`.

## Heads-up: no MCP outbound

Aider does not have a native MCP client (as of mid-2026; see [aider-ai/aider#4506](https://github.com/aider-ai/aider/issues/4506)). That means **ZeroMind's tools are not callable from Aider** — only the operating manual content reaches it. If you want full ZeroMind tool access, pair Aider with a separate MCP-capable agent for the engine work, or use one of the other harnesses listed in [`../README.md`](../README.md).

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
