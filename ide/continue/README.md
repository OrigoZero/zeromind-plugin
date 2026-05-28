# ZeroMind for Continue

[Continue](https://www.continue.dev/) is an open-source AI assistant for VS Code and JetBrains with MCP support.

## Prerequisite

**Node.js 18 or newer must be installed.** Install from https://nodejs.org if needed.

## Install

Add ZeroMind to Continue's MCP config (`~/.continue/config.yaml`):

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

Reload Continue. The first engine-related prompt will trigger the one-time device-code link.

## What you get

Same first-class onboarding as every other MCP client — orientation via MCP `instructions`, `getting_started` block on the first `auth_status` call, and on-demand long-form guides via `zeromind.help`.

## Troubleshooting

**"status failed" after install** → Node.js isn't on PATH. Install from nodejs.org, restart your editor, retry.
