# ADR-0009 — Multi-engine roadmap: codex (and others) as swappable runners

Status: proposed · 2026-08-27

## Context

The user wants the option to run goals — or individual tasks — on engines other than Claude Code (OpenAI codex first), to maximise what a goal can draw on. Nothing is implemented yet; this ADR records the direction and the honest difficulty so a later round starts from facts.

## Where we already are

- `ClaudeRunner` is an interface (`packages/runner`), and `ModelFallbackRunner` proves the engine tolerates a wrapping/substituting runner.
- Every session goes through one `runner.run(spec)` funnel with per-call `meta {goalId, tier}` — a routing point already exists.

## The honest difficulties

1. **The boundary guard is Claude Code machinery.** Safety (`git push`/deploy/publish blocking, the fail-closed canary) is implemented as Claude Code PreToolUse hooks. codex has no equivalent hook surface — a codex worker would run *without* the boundary. The security model must be rebuilt for it (sandbox, PATH shims, or a proxy) before any codex session touches a workspace.
2. **RunSpec is Claude-shaped.** `appendSystemPromptFile`, `agents` (subagents), `jsonSchema` structured output, `settingSources`, `resumeSessionId` (Continuations!), rate-limit signals — codex supports a different, smaller set. Continuations and structured output need per-engine fallbacks (fresh session + prompt-embedded JSON contract).
3. **Skills do not travel.** The whole skills system (catalog, packs, autoskills, workflow mandates) is Claude Code's. A codex worker gets prompts only; scenario packs must degrade to inline instructions.
4. **Cost/usage accounting differs.** The usage ledger and rate-limit pause are built on Claude CLI result fields; codex needs its own adapter and its own limits handling.

## Suggested path (later round)

1. Extract a minimal `EngineRunner` surface (prompt, cwd, model, caps, timeout, label) + per-engine capability flags; keep the Claude-specific fields in a `claude` extension of the spec.
2. Per-goal `runnerProfile` (user-selectable, like models): `claude` (default) or `codex`. **Worker sessions only** at first — Clarify, reviews, merges and the Documenter stay on Claude, because they rely on structured output, read-only enforcement and subagents.
3. Ship codex behind a sandbox story for (1); until that exists, codex tasks run only in goals whose delivery mode is `local` and whose repo has no remotes, as a hard guard.
4. Revisit per-task routing (`Task.runner`) only after per-goal works.

## Decision

Deferred — implement nothing now. Any implementation must satisfy difficulty (1) first; a runner without the boundary is not acceptable at any speed.
