# Security

## Reporting a vulnerability

Report it privately through GitHub. Open the [Security tab](https://github.com/OrigoZero/zeromind-plugin/security) of this repository and choose "Report a vulnerability", or go straight to the [report form](https://github.com/OrigoZero/zeromind-plugin/security/advisories/new). Only the maintainers can read what you send there.

Do not open a public issue or pull request for a vulnerability.

In the report, say:

- what you found and what an attacker could do with it;
- the steps to reproduce it;
- the version of `@origozero/zeromind`, your operating system and the agent harness involved.

Leave real credentials out. An install secret (`ins_sec_...`) pasted into a report should be treated as leaked: run `npx -y @origozero/zeromind unlink` to revoke it, then link again.

## Scope

This repository holds the `@origozero/zeromind` CLI, the skills, and the per-harness manifests and bundles. The same form takes reports about the ZeroMind service the CLI talks to (`https://origozero.ai`, including the MCP server at `/mcp`).

## Supported versions

Fixes go into the latest version of `@origozero/zeromind` on npm. Earlier versions are not patched.
