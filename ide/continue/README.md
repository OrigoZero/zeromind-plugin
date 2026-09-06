# ZeroMind for Continue

[Continue](https://www.continue.dev/) is an open-source AI assistant for VS Code and JetBrains.

**Native channel:** `.continue/rules/<name>.md` — auto-activated per project (plus inline `rules:` strings in `config.yaml`).

## Install

Two pieces — the rule and the MCP server.

### 1. The rule

```
npx @origozero/zeromind install continue   # writes .continue/rules/zeromind.md
```

### 2. MCP server

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: zeromind
    type: streamable-http
    url: https://origozero.ai/mcp
    requestOptions:
      headers:
        Authorization: "Bearer ins_sec_..."
        X-ZM-Harness: continue
```

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Reload Continue. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
