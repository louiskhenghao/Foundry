# ADR-0016: MCP servers: listed from Claude Code's config, installed at user scope, allowed in goals per server

**Status:** accepted · 2026-09-28 · amended by ADR-0019 (provider-scoped extensions and native status)

## Context

Sessions load the user's MCP servers because they run the host `claude` (ADR-0001), but every role runs in `dontAsk` mode with a fixed tool list. An MCP tool that is not on the list is silently denied, so the only MCP server a goal could use was media-pipeline, hard-coded into `WORKER_TOOLS` for the image packs. Servers the user installed themselves loaded in every session and were refused on every call. Foundry could neither show which servers exist nor install one.

MCP tools act outside the repository: a mail connector can send mail, a GitHub server can open issues. In `dontAsk` mode nobody is asked before such a call.

## Decisions

1. **The list is read from Claude Code's own files, not from `claude mcp list`.** User-scope servers are `mcpServers` in `~/.claude.json` (under the engine's Claude home), plugin-shipped servers are the `.mcp.json` of each installed plugin, and claude.ai connectors are the names in `claudeAiMcpEverConnected`. `claude mcp list` starts or connects to every server to check its health, which is slow and has side effects, so it runs only when the user presses **Check**.

2. **Installing writes user scope through the CLI.** `claude mcp add-json --scope user` (catalog entries and custom servers alike), `claude mcp remove --scope user`, both through the Skills operation queue. User scope means the server also works in the user's terminal, and Claude Code stays the only place its configuration and keys live: a key entered at install is passed as an environment entry of the server and Foundry keeps no copy. Project scope (`.mcp.json` committed into the repository) and a Foundry-only `--mcp-config` were rejected: the first writes into the user's repository, the second hides the server from the user's own Claude Code.

3. **Each server has an "Allowed in goals" switch; only worker sessions get allowed servers.** `workflow.mcpAllowed` (a setting) holds tool prefixes: `mcp__<server>` for user scope, `mcp__plugin_<plugin>_<server>` for plugins, `mcp__claude_ai_<name>` for connectors (Claude Code's own name normalisation: non-`[A-Za-z0-9_-]` become `_`, collapsed and trimmed for `claude.ai` names). Sessions that use the worker tool list (attempts, merges, docs, style samples) get `WORKER_BASE_TOOLS` plus the allowed prefixes (`workerTools`); Clarify, reviewers and the other read-only roles get none. A server installed from Foundry's catalog is added to the list; servers the user installed and connectors start off. media-pipeline stops being hard-coded: it is in the default list, so image packs keep working and it can be switched off like any other.

4. **A refused MCP tool offers the fix where it surfaces.** When a task fails with MCP denials, the "Tool denied" Inbox item names the server and offers **Allow this server and retry**, which adds its prefix to `workflow.mcpAllowed` and retries the task.

5. **Recommendations are a curated catalog** (`catalog/mcp.json`), like the skills catalog: each entry has a tier, what it is good for, its install JSON and the keys it asks for. Servers that need no key are `recommended` (Setup shows ⚠ while missing), servers that need one are `optional`. Mutually exclusive choices share a `pack` (web search: Exa or Brave).

## Consequences

- A server's tools reach goals only after an explicit choice: catalog install, the switch, or the Inbox button. Existing installs (gitnexus, connectors) stay refused until switched on, as before.
- Removing a user-scope server from Foundry removes it from the user's Claude Code too; the confirmation says so. Plugin-shipped servers are removed with their plugin, connectors on claude.ai.
- In Docker the user scope lives in the `claude-home` volume, so installs survive updates; a stdio server needs its command in the image (`npx` and `uvx` are there).
- `workflow.mcpAllowed` is a normal setting (file > env > default), so it shows in Settings' reference and survives restarts.
