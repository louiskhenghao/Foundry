# ADR-0019: Provider-scoped extensions, native account quota and read-only history

**Status:** accepted · 2026-10-04 · amends ADR-0016 and ADR-0017; amended by ADR-0020

## Decision

Scope Setup, Skills and MCP operations explicitly by provider, independent of the launch profile. Preserve omitted-provider API requests as launch-default requests. Each native home owns its configuration and credentials. Codex authentication supports ChatGPT only; account status uses native metadata and never reads credential files directly.

Use independent Claude and Codex MCP allow lists. Existing Claude permissions stay in `workflow.mcpAllowed`; `workflow.codexMcpAllowed` starts empty. Worker, merger, documenter and style-sample sessions use their goal's provider policy. Codex MCP management delegates configuration and OAuth to the native CLI. Connection checks use native MCP discovery without inference. Legacy SSE and Claude account connectors are not translated into Codex configuration.

Read ChatGPT account identity and quota through bounded native app-server requests. Cache quota for 60 seconds (15 seconds for errors), coalesce readers, and discard it when account credentials change. An explicit refresh bypasses cached values. Prefer all native quota buckets over the legacy single bucket. Preserve unknown permission, windows and resets. Only the explicit native allowance describes reported ordinary usage availability; percentages and reset timestamps never imply recovery. Local session totals remain separate, and USD costs remain unavailable.

Browse external Codex history read-only using native state-database listings and paginated history requests. Do not resume threads or infer external process liveness from a newly launched app-server. Label it unknown, bound retrieval, expose stale/error warnings and deduplicate every known Foundry session and native child. Foundry can stop its own sessions only.

Run autoskills with the selected provider. Codex project skills live in `.agents/skills` and are copied into task worktrees. Never stage deletion of existing tracked native skill links as part of legacy Claude symlink cleanup.

## Trade-offs

The UI shares workflows, but native protocols retain their distinct capabilities. Native status depends on an installed compatible CLI; unavailable or malformed responses become explicit unknown/error states. Native subprocesses use deadlines, output bounds and process-group cleanup so cancellation cannot leave sidecars running. Codex plugins and skill invocation telemetry remain outside this adapter, and native subagent creation remains disabled inside Foundry-managed sessions.
