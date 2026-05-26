# ZeroMind for Codex

Install:

```bash
codex mcp add zeromind -- npx -y @origozero/zeromind
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.zeromind]
command = "npx"
args = ["-y", "@origozero/zeromind"]

[mcp_servers.zeromind.env]
ZEROMIND_IDE_NAME = "codex"
```

Restart Codex. The first engine-related prompt will trigger the device-code link flow.
