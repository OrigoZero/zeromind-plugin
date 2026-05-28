"""ZeroMind Hermes plugin.

Hermes' canonical channel for an external MCP server is `mcp_servers.zeromind`
in `~/.hermes/config.yaml` — that's what wires up the tools (auth_status,
zeromind.search, world.connect, execute, capture, …). This plugin adds
the *complementary* surface: agent skills, a slash command, and a
context-injection hook that primes the agent with the find-before-build
rule at the start of each session.

Discovery contract: Hermes calls `register(ctx)` once at startup. See
https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin
"""

from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent
ORIENTATION = (PLUGIN_DIR / "ORIENTATION.md").read_text(encoding="utf-8") if (PLUGIN_DIR / "ORIENTATION.md").exists() else ""


def register(ctx):
    """Register ZeroMind skills, slash command, and context hook with Hermes."""

    # Skills — markdown agent capabilities. Hermes auto-loads SKILL.md files
    # from `<plugin>/skills/<name>/`, but we register them explicitly so
    # `provides_skills` in plugin.yaml gates discovery cleanly.
    for skill_name in ("zeromind-getting-started", "zeromind-library"):
        skill_path = PLUGIN_DIR / "skills" / skill_name / "SKILL.md"
        if skill_path.exists():
            ctx.register_skill(
                name=skill_name,
                description="ZeroMind — find-before-build rule and the four discovery/install/engage tools." if skill_name.endswith("library") else "ZeroMind — engine + world + workflow orientation.",
                content=skill_path.read_text(encoding="utf-8"),
            )

    # /zeromind slash command — quick way to ask the agent to start a
    # ZeroMind flow without typing the full prompt.
    def _zeromind_command(args, **_):
        topic = (args or "").strip() or "getting-started"
        # Defer to the MCP server's `zeromind.help` tool — Hermes' tool
        # registry already exposes it once the MCP server is connected.
        return ctx.dispatch_tool("zeromind.help", {"topic": topic})

    ctx.register_command(
        name="zeromind",
        description="Open the ZeroMind operating manual. Pass a topic: getting-started | library | linking | workflow | tools.",
        handler=_zeromind_command,
    )

    # pre_llm_call hook — on the very first turn of a session, inject the
    # condensed orientation so the agent reaches for `zeromind.search`
    # before defaulting to "let me code this from scratch."
    if ORIENTATION:
        def _inject_orientation(session_id, user_message, conversation_history, is_first_turn, model, platform, **_):
            if not is_first_turn:
                return None
            return {"context": ORIENTATION}

        ctx.register_hook("pre_llm_call", _inject_orientation)
