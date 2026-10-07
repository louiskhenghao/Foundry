# ADR-0018: Codex role presets, model discovery and captured goal settings

**Status:** accepted · 2026-10-04 · amends ADR-0014 and ADR-0017 · amended by ADR-0028

## Decision

Keep Claude and Codex model presets independent. Codex presets hold a model and optional reasoning effort for every role, including housekeeping, in code, documents/research and media tables. The built-in Max, Production, Balanced and Economy presets express reasoning profiles using the native default model; their names do not promise price, model entitlement or relative quality.

Capture a Codex goal's complete preset tables and ordered fallbacks at creation. Replace `codex-default` with the configured base model, unless that is also `codex-default`, which explicitly retains native CLI resolution. A per-goal model override replaces role models; a goal-wide effort overrides role effort. A null goal effort uses the role settings, and a null role effort delegates to the CLI. Editing or deleting a preset cannot change existing Codex goals. Preserve legacy single-model goals and Claude's existing live-preset behavior.

When no preset is explicitly selected, capture each nature's configured default table. Auto classification selects the relevant captured table, so a Docs or Media default remains effective without consulting mutable settings. An explicit preset supplies all nature tables itself.

Use the native Codex app-server model catalog for discovery. Sync has no inference side effect and records advertised reasoning levels without claiming the account can run every listed model. Custom IDs remain possible. An explicit Test action runs a short native session and warns that it consumes quota; report USD cost as unavailable.

Route fallback only for model-unavailability errors, within the same provider, and remember the replacement for that goal. Authentication, quota, transient transport failures and unsupported effort settings must not silently switch the model. Keep native session IDs provider-specific.

Run Codex planning as a separate Foundry-managed session using the Planner role settings. This makes the Planner assignment effective while native Codex multi-agent delegation remains disabled.

## Trade-offs

Captured settings make running Codex goals reproducible, at the cost of requiring a new goal to adopt a preset edit. Leaving `codex-default` intentionally trades exact model reproducibility for the user's native CLI configuration. Discovery is cheaper and less intrusive than testing every model, but only an explicit session verifies model access for the current account. The shared interface exposes these distinctions rather than treating catalog discovery or preset names as guarantees.
