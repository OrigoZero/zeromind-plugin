# ZeroMind for Goose

[Goose](https://block.github.io/goose/) is Block's open-source MCP-native agent.

**Native channel:** `~/.config/goose/.goosehints` (global instructions file).

## Install

Two pieces — the hints file and the MCP server.

### 1. .goosehints

```
npx @origozero/zeromind install goose   # appends a ZeroMind block to ~/.config/goose/.goosehints
```

Re-running is idempotent.

### 2. MCP server

`zeromind install goose` writes the extension into `~/.config/goose/config.yaml`:

```yaml
extensions:
  - name: zeromind
    display_name: ZeroMind
    enabled: true
    type: streamable_http
    uri: https://origozero.ai/mcp
    headers:
      Authorization: "Bearer ins_sec_..."
      X-ZM-Harness: goose
    timeout: 300
```

Or register through the Goose desktop UI's MCP servers page. `goose mcp add` takes no HTTP flags, so it cannot register this server.

The install secret is the `install_secret` in `~/.config/zero/session.json` (`%APPDATA%\zero\session.json` on Windows). `zeromind install <harness>` writes the whole entry for you after `zeromind link`.

Restart Goose. If this machine has never been linked, the install runs `zeromind link` first — a one-time device-code approval in your browser.

## Troubleshooting

**"status failed" / 401** → this machine is not linked, or its config holds a stale secret. Run `npx @origozero/zeromind link`, then re-run `npx @origozero/zeromind install <harness>` to rewrite the entry. Node.js is needed to run those two commands; the server itself is reached over HTTPS, not spawned locally.
