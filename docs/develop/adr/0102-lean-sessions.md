# ADR-0102: Lean sessions load only what Foundry gives them

**Status:** accepted · 2026-11-16 · builds on ADR-0016

## Context

Every model turn of a session reads its whole context again, and the context starts with whatever the coding agent
loads before the first word of the prompt. Measured with Claude Code 2.1.323 on one installation (a one-turn session,
the tokens it read):

| What the session started with | Tokens |
|---|---|
| Everything Claude Code loads by default | 47.6k |
| Without the four claude.ai connectors (Gmail, Calendar, Drive, Docs) | 45.0k |
| Without any MCP server | 40.6k |
| Without any MCP server or user setting | 31.7k |

A Foundry session loads all of it, though most of it is of no use there. Its tools are limited to the MCP servers
**Allowed in goals** (ADR-0016) — by default one — yet every server the person installed starts in every session, with its
tool names and instructions in the context, and so do the claude.ai connectors. The person's own skills are listed too
(gstack's seventy on this machine), and a worker may invoke one of them in the middle of a task.

Dropping the user settings (`--setting-sources project,local`) looks like the obvious cut and is the wrong one: it also
drops the `env` and `apiKeyHelper` a Bedrock, Vertex or proxy setup depends on, every plugin Foundry installed (the
mattpocock suite, ui-ux-pro-max, media-pipeline) and Claude Code's own skill hints. `--bare` skips the sign-in and the
hooks, Foundry's boundary guard among them.

## Decision

**A setting, Lean sessions** (`workflow.leanSessions`, Settings → Skills, off by default), makes each Claude Code session
Foundry starts load only what Foundry gives it:

- **MCP servers are handed over explicitly** with `--strict-mcp-config`: each server the session may call — the ones its
  allowed tools name, else what its goal allows — as Claude Code would load it, under the same name so its tools keep
  their names. A user-scope server is copied from `.claude.json`; a plugin's goes as `plugin_<plugin>_<server>` with
  `${CLAUDE_PLUGIN_ROOT}` written out (Claude Code expands `${VAR}` and `${VAR:-default}` in passed config as in a
  `.mcp.json`, verified). A reviewer, which may call no MCP tool, gets none. A server that cannot be handed over that
  way — a claude.ai connector, a plugin server reading another `${CLAUDE_PLUGIN_*}` variable — leaves the session to the
  servers Claude Code loads itself, as without the setting. A repository's own `.mcp.json` is never read.
- **The claude.ai connectors are switched off** (`disableClaudeAiConnectors` in the session's flag settings) unless one
  is among what the session may use.
- **The person's own skills are turned off** (`skillOverrides`, keyed by the name in each skill's frontmatter): user
  skills without Foundry's marker whose name no catalog entry has, except a name the goal folder's project skills use.
  Plugins are left whole.

The settings, sign-in, `CLAUDE.md`, plugins and hooks stay. Codex and Antigravity sessions are unchanged.

## Consequences

- With the setting on, the session above started with 44.9k tokens with all five of its servers allowed, and 40.5k
  with only the default one: 6% and 15% less, on every turn. Every allowed server still connected.
- The skill cut is small in tokens (about 1k: Claude Code bounds its skill listing) and is there for focus: a worker no
  longer sees seventy skills of the person's own.
- A user who relies on a skill of their own in Foundry's sessions loses it with the setting on; hence off by default.
  The MCP part changes nothing a session could use (a server not allowed has its tools denied anyway) and is the
  candidate to become the default once it has run for a while.
- Server definitions, a token in a header included, reach the `claude` command line as they already do for a session on
  an added account (ADR-0065).

## Alternatives considered

- **`--setting-sources project,local`** — saves the most and breaks the most (above).
- **`enabledPlugins` off for plugins outside the catalog** — measured: no token saved (Claude Code bounds the listing),
  and telling Foundry's plugins from the person's by name is guesswork.
- **`disableBundledSkills`** — measured: the context grew by 6k.
