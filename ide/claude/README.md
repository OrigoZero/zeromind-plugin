# ZeroMind for Claude Code

**Native channel:** skills (`<scope>/.claude/skills/<name>/SKILL.md` with YAML frontmatter; progressive disclosure via the description) and the plugin marketplace.

## Prerequisite

**Node.js 18+** on PATH. https://nodejs.org if needed; restart Claude Code after install.

## Install

Marketplace (recommended — bundles both the MCP server and the skills):

```
/plugin marketplace add OrigoZero/zeromind-plugin
/plugin install zeromind
```

Or drop just the agent skill into a project without the marketplace plugin:

```
npx @origozero/zeromind install claude            # writes .claude/skills/zeromind/SKILL.md
npx @origozero/zeromind install claude --global   # writes ~/.claude/skills/zeromind/SKILL.md
```

Restart Claude Code. The first engine-related prompt triggers the one-time device-code link.

## Troubleshooting

**"status failed"** → Node.js isn't on PATH. Install from nodejs.org, restart Claude Code.
