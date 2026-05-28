# ClawHub publish package

This directory is the publish-ready package for the ZeroMind skill on
[ClawHub](https://github.com/openclaw/clawhub) (openClaw's public skill
registry).

## Layout

- `zeromind/SKILL.md` — the canonical SKILL.md (sourced from
  `skills/zeromind-getting-started/SKILL.md` in the main repo)
- `zeromind/clawhub.json` — ClawHub manifest

## Publish

From this directory:

```
cd zeromind
clawhub publish
```

`clawhub` requires authentication. The maintainer needs their ClawHub API key
configured (`clawhub auth` or `~/.openclaw/clawhub-token`).

## Sync

After publishing, ZeroMind is installable in openClaw via:

```
openclaw skills install zeromind
```

The `zeromind install openclaw` CLI in the main package shells out to
`openclaw skills install` when the openClaw CLI is on PATH, so users with
openClaw installed get the ClawHub install path automatically. When the CLI
isn't available, the installer falls back to dropping `SKILL.md` directly.

## Updating

On every release of the npm package, refresh `zeromind/SKILL.md` from the
canonical source and re-publish:

```
cp ../../skills/zeromind-getting-started/SKILL.md zeromind/SKILL.md
cd zeromind
clawhub publish --bump
```
