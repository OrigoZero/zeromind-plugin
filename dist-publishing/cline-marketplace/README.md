# Cline MCP Marketplace submission

[Cline](https://github.com/cline/cline) maintains a curated MCP Marketplace at
[cline/mcp-marketplace](https://github.com/cline/mcp-marketplace) that gives users one-click installs
inside the Cline UI.

## Submission

1. Fork [cline/mcp-marketplace](https://github.com/cline/mcp-marketplace).
2. Copy [`zeromind.json`](./zeromind.json) into the marketplace's `mcp-servers/`
   directory (the path may have changed — read the marketplace repo's
   contribution guide first).
3. Open a PR. The marketplace maintainers manually review listings.
4. Once merged, ZeroMind appears in Cline's MCP Marketplace UI and users
   can install it in one click.

## Updating

When `@origozero/zeromind`'s version, description, or icon change, open a
follow-up PR to the marketplace repo with the updated `zeromind.json`.

## Until the listing is live

Direct users to [`ide/cline/README.md`](../../ide/cline/README.md) for the
manual install (Cline MCP Servers UI + `npx @origozero/zeromind install cline`
for the `.clinerules` file).
