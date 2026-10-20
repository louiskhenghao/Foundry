# PRD: Unused skills on the Extensions page

## Objective

Every installed skill weighs on every session's context. Before this change, the Extensions page could not tell a person which skills Foundry's sessions actually invoke. The page now shows, for each skill a person can trim there, whether the sessions of recent goals used it. With this, a person can decide what to uninstall.

## Scope

In scope:

- A pure aggregator in the engine that counts, per installed skill, the goals and sessions that invoked it over the newest N goals, and when it was last invoked.
- A `usage` field per installed row and a `usageWindow` field on `GET /api/skills`.
- On the Claude Code side of the Extensions page: an **unused** chip, a usage line on used rows, an **unused only** filter and a one-line note under the Skills heading.
- Tests for the aggregation, the API field and the page's row, filter and note.
- The Skills section of the guide (English and Chinese) and the Skill entry in `CONTEXT.md`.

Out of scope:

- Uninstall automation. The feature only shows information.
- Codex. Codex reports no skill invocations, so its view keeps the existing "telemetry unavailable" line.
- A per-source "N unused" count, a Settings entry for N, or an interactive count in the note.

## Acceptance criteria

1. Only Claude goals count. The window holds the newest 30 by `createdAt`, in any state.
2. Every session kind counts: `session.usage` events of any kind, and `attempt.finished` for sessions without a usage event. Each session counts once, by its id.
3. An invoked name matches a row when it equals the row's bare name or ends with `:<bare name>`. A suite row such as `pstack:tdd` matches only `pstack:tdd`. If a user-level copy and a plugin copy share a bare name, a prefixed invocation counts for both rows.
4. Only user-level and plugin rows are measured. Project rows (for example `foundry-learnings`) carry `usage: null` and are left out of the count.
5. If the window holds no goals, usage is unknown, not unused: every row has `unused: false`, and the note reads **No goals yet: skill usage is unknown**.
6. `GET /api/skills?goals=N` sets the window. The server clamps N to 1–500. An unparsable value falls back to 30. The page does not expose N.
7. The note and the chip title name the goals actually counted. For example, with 7 goals: **3 of 42 installed skills were never used in the last 7 goals**, and *no session invoked it in the last 7 goals*.
8. Used rows show **used in N goals · last X ago** in the meta line under the name. Unused rows show an amber **unused** chip there.
9. The **unused only** checkbox sits next to **needs attention**. The number in the note is plain text.

All nine are met.

## What was built

**Engine.** `packages/engine/src/skills/usage.ts` holds two functions:

- `skillMatches(invoked, name)` is the one name matcher. The mandate check (`usedSkill` in `checks/reviewer.ts`) and the attempt prompt's workflow line (`summarizeReport` in `attempt-prompt.ts`) now use it too.
- `skillUsage({ installed, goals, events, limit })` takes goals and events as plain inputs and returns the annotated rows and the window `{ goals, limit }`. The function ignores a leading `/` on an invoked name. It resolves an `attempt.finished` event to its session through `attempt.started` and `attempt.session`. It does not mutate its inputs.

**Manager.** `SkillsManagerOptions` has a new `usage` callback. `SkillsManager.overview(repoPath, { goals })` calls it with the scanned rows and the limit (default 30). The engine passes the callback in `makeSkills` for the Claude manager only. The callback reads the engine's own store, so the skills package does not depend on the store.

**API.** Each `InstalledSkill` row can carry `usage: { goals, sessions, lastUsedAt, unused }`. The value is `null` for project rows. On Codex the field is absent. `SkillsOverview` has a new `usageWindow: { goals, limit } | null` field, which is `null` on Codex.

**Web.** `SkillsPage.tsx` adds `rowFilter` (scope, search, **needs attention** and **unused only** together) and `usageNote`. `SourceGroup.tsx` shows the chip and the usage line. The usage line's title gives the session count ("invoked in N sessions").

**Tests.** The tests are in `packages/engine/src/skills/usage.test.ts` (matching, the suite row, the window, Codex goals, no goals, project rows, counting a session once), `packages/server/src/skills-usage-api.test.ts` (the field, `?goals=` clamping, project rows, Codex) and `apps/web/tests/SkillUsage.test.tsx` (row, filter, note).

## Deviations from the plan

- **Codex goals are excluded.** The goal asked for "the last N goals of this engine". A Decision limited the window to Claude goals, because Codex goals record no invocations and would make every skill look unused.
- **No goals means unknown, not unused.** The goal said that rows with no match are `unused`. A Decision changed this for an empty window, so a fresh instance does not mark every skill.
- **Project rows are not measured.** Sessions read project skills passively, so a count would always say unused.
- **`usageWindow` was added.** The goal named only the per-row `usage` field. The page needs the number of goals actually found to word the note and the chip title.
- **The mandate check is slightly stricter.** The goal asked the aggregation to share `usedSkill`'s matcher. With the shared `skillMatches`, a mandated suite name such as `pstack:tdd` no longer matches a longer name such as `other:pstack:tdd`.
- **The screenshot was not re-captured.** `scripts/screenshots.ts` does not capture the Claude Code Extensions view, so the guide's text changed and its pictures did not.
