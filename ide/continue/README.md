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
    command: npx
    args:
      - -y
      - "@origozero/zeromind"
    env:
      ZEROMIND_IDE_NAME: continue
```

Reload Continue. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart your editor.
