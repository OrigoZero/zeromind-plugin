# Hermes optional-mcps catalog manifest

PR-ready entry for [Hermes Agent's `optional-mcps/`](https://github.com/nousresearch/hermes-agent/tree/main/optional-mcps) directory. Once merged upstream, users can install ZeroMind in Hermes with:

```
hermes mcp install zeromind
```

## Submit

1. Fork [`nousresearch/hermes-agent`](https://github.com/nousresearch/hermes-agent).
2. Create `optional-mcps/zeromind/manifest.yaml` with the contents of this file.
3. Open a PR.

## Until it's merged

`npx @origozero/zeromind install hermes` writes the same `mcp_servers.zeromind` block into the user's `~/.hermes/config.yaml` directly — no upstream dependency.

## The install secret

A published bundle never holds a secret, so this one names `${ZEROMIND_INSTALL_SECRET}` and Hermes expands it. Run `npx @origozero/zeromind link` once, then either export that variable, or run `npx @origozero/zeromind install hermes`, which writes the same entry with this machine's own `install_secret` in place of the expansion.
