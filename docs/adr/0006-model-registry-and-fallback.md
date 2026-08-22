# ADR-0006 — No hard-coded model knowledge: a learned registry and a fallback chain

Status: accepted · 2026-08-22

## Context

Claude models come and go: new families appear (Fable 5 today), aliases move to newer releases, pinned ids retire. ai-engine passes model names straight to `claude --model`, which already makes family aliases (`fable`, `opus`, `sonnet`, `haiku`) follow the latest release. What was missing: the UI only knew a hard-coded list, a retired model made every session of a goal fail the same way, and nothing warned ahead of time.

## Decisions

1. **Passive model registry** (`data/models.json`). Every session reports, in its `init` message, the id the requested name resolved to; every result says whether it worked. The engine records `name → resolvedId, lastOkAt, lastFailAt, lastError` with no extra calls. A seed list of family aliases is only a starting point. The Settings dropdown is fed from the registry (`GET /api/models`), so a new family is one custom entry away and appears with its resolved id after its first session. A **Test** button runs one short session on demand (`POST /api/models/probe`) — the only time the registry costs money.

2. **Failure classification in the runner.** `RunResult.failureClass` (`model_unavailable | auth | rate_limit | other`) is derived from the CLI's error text. Model-unavailability is the class that matters for fallback; the patterns cover "not found", "does not exist", "deprecated", "unknown/invalid model", "no longer available".

3. **Fallback chain, transparent to call sites.** `ModelFallbackRunner` wraps the real runner. A session that fails with `model_unavailable` *before doing anything* (zero turns, zero cost) is re-run with the next model of `models.fallbacks` (default `opus → sonnet → haiku`); the consumer sees one event stream and one result. Each swap emits `goal.models_changed {tier, from, to}` (updating the goal's model snapshot so later sessions go straight to the replacement) and a warning note. Only when every candidate fails does the ordinary escalation path take over. Sessions that already produced work are never silently re-run.

4. **Doctor check.** The configured tiers are compared with the registry: a name that never resolved here, or whose last session failed for model reasons, is a warning with a shortcut to Settings; pinned ids are mentioned as such.

## Consequences

- Upgrading is a no-op for aliases; retirement degrades gracefully and leaves an audit trail; the UI never needs a code change to offer a new model.
- The registry is per machine and learned — a freshly installed engine lists only the seeds until sessions run (or Test is pressed).
- Claude Code's own `--fallback-model` (overload handling) is kept where it was; the engine's chain is about availability, not load.
