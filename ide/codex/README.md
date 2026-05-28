# ZeroMind for Codex CLI

**Native channel:** `AGENTS.md` — project root or `~/.codex/AGENTS.md` (layered global + project).

## Install

Two pieces — the AGENTS.md instructions and the MCP server.

### 1. AGENTS.md (instructions)

```
npx @origozero/zeromind install codex             # writes ~/.codex/AGENTS.md
npx @origozero/zeromind install codex --project   # appends a ZeroMind block to ./AGENTS.md
```

Re-running the command is idempotent — it replaces the existing ZeroMind block instead of duplicating it.

### 2. MCP server

```
codex mcp add zeromind -- npx -y @origozero/zeromind
```

Or hand-edit `~/.codex/config.toml`:

```toml
[mcp_servers.zeromind]
command = "npx"
args = ["-y", "@origozero/zeromind"]

[mcp_servers.zeromind.env]
ZEROMIND_IDE_NAME = "codex"
```

Restart Codex. The first engine-related prompt triggers the one-time device-code link.
