# Continue Hub blocks

Native [Continue Hub](https://docs.continue.dev/hub/blocks/block-types) blocks for ZeroMind.

## Layout

Two block types, one per Hub block category:

- `rules/zeromind.md` — a **rule** block (agent instructions; Hub block type `rules`)
- `mcp-servers/zeromind.yaml` — an **mcpServers** block (Hub block type `mcpServers`)

## Publish

Hub blocks are published from a Continue Hub owner namespace. Steps:

1. Sign in to [hub.continue.dev](https://hub.continue.dev/) as `origozero`.
2. Create two blocks: `OrigoZero/zeromind-rule` (rule) and `OrigoZero/zeromind-mcp` (mcpServers).
3. Upload the contents of `rules/zeromind.md` and `mcp-servers/zeromind.yaml` respectively.

Per the Hub docs, blocks are referenced by slug (`owner/item-name`) from a user's `config.yaml`.

## End-user install (once published)

Add to `~/.continue/config.yaml`:

```yaml
rules:
  - uses: OrigoZero/zeromind-rule
mcpServers:
  - uses: OrigoZero/zeromind-mcp
```

That's a one-line install per block. Continue handles version pinning, updates, and fetching.

## Until the Hub blocks are live

`npx @origozero/zeromind install continue` writes the rule file and MCP server entry locally (`.continue/rules/zeromind.md` + `~/.continue/config.yaml`) — see [`ide/continue/README.md`](../../ide/continue/README.md).
