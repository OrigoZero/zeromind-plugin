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

Hand-edit `~/.codex/config.toml`:

```toml
[mcp_servers.zeromind]
url = "https://origozero.ai/mcp"
http_headers = { "Authorization" = "Bearer ins_sec_...", "X-ZM-Harness" = "codex" }
```

`codex mcp add zeromind --url https://origozero.ai/mcp` registers the address, but the CLI has no `--header` flag, so it cannot carry the bearer or `X-ZM-Harness` — which is why `zeromind install codex` writes this file directly (mode 0600 off Windows). The shipped plugin bundle uses `env_http_headers = { "Authorization" = "ZEROMIND_INSTALL_SECRET_BEARER" }` instead, reading the whole header value from that variable.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Codex. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.
