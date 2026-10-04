# ADR-0017: Fixed goal providers and independent accounts

**Status:** accepted · 2026-10-04 · supersedes ADR-0009; amends ADR-0001 and ADR-0004; amended by [ADR-0018](0018-codex-role-presets-and-model-discovery.md) (Codex role presets, fallback and separate planning) · amended by ADR-0019 (provider-scoped extensions and native status)

> Current implementation: Later amendments add Codex role presets and separate planning (ADR-0018), native quota/history and extensions (ADR-0019), and native plugin install/remove (ADR-0020). Read [the current capability guide](../../operate/codex.md#product-capabilities) for remaining limits.

## Decision

Share the goal engine, checks and delivery machinery. Persist `provider` on each goal and route every session, including distillation, through that immutable choice. Use native CLI adapters; never translate a session ID across providers. Codex's planner runs in the clarification session, with native multi-agent delegation disabled.

One semaphore bounds concurrency across both runners. Rate-limit pauses, login sessions, model registries and explicit model probes are per provider. Account actions explicitly name their provider; the old unqualified auth API continues to use the launch profile. Sign-out is refused while engine work is active because credentials are shared with the local CLI.

Codex's native hooks and OS sandbox enforce its execution boundary. A hook canary must be observed before work proceeds. This is a command guard, not a complete security boundary against arbitrary repository code. Structured results and resumes use the native protocol.

## Compatibility

Before scheduling, old goals receive a `goal.provider_assigned` event from their data directory's original launch profile. Replay applies it only when the field is absent. Existing directories keep their provenance marker and are not automatically combined. New goals can select either provider within that directory. Running older binaries against a mixed-provider directory is unsupported.

Codex goals snapshot one model for all roles. Claude presets and fallbacks remain Claude-specific. Native `codex-default` follows CLI configuration. Codex plugin/MCP management and external-session discovery are explicitly unavailable in Foundry; native skills remain usable. Extension management in the UI continues to follow the launch profile.

## Measurements

Codex reports tokens, not USD cost or account quota. Remove USD caps from Codex goals at every budget entry point; hide dollar controls and show unavailable where old numeric fields remain for compatibility. The turn cap bounds tool calls, not model turns. No Skill-tool telemetry means unknown use, not a skipped skill. Only the affected provider pauses on a usage error; a five-minute retry without a reset signal must not be described as a known quota reset.

## Trade-offs

Shared orchestration avoids two diverging products, but requires provenance on every session-producing path. Tests cover routing, replay, account isolation, concurrency, usage attribution and pauses. Advanced role model routing, native Codex subagents, native plugin/MCP management and external Codex session import are outside this implementation; the Accounts page reports these limits.
