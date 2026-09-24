# ADR-0002: Append-only event log as the source of truth

**Status:** accepted · 2026-08-21

## Context

The engine coordinates long-running, parallel, crash-prone work: subprocesses that take minutes, human Escalations that may take hours, and an engine process that can be killed at any time. The UI needs a real-time stream of what is happening, and debugging a failed Goal requires knowing exactly what happened in what order.

A conventional mutable-row model (`UPDATE tasks SET state=…`) makes crash recovery and auditability awkward: after a crash you cannot tell what was in flight, and the UI needs a separate notification channel.

## Decision

Every state change is an event appended to a single `events` table in SQLite. Read models (`goals`, `tasks`, `attempts`, `checks`, `check_results`, `escalations`) are projections updated in the same transaction by pure reducers, and can be dropped and rebuilt by replaying the log. The WebSocket feed to the UI is the same event stream.

Raw Claude `stream-json` output is *not* stored in the log; it goes to one transcript file per Attempt. The log stores references (session ids, git refs, file paths), not bulk content.

On boot the engine replays (or verifies) the projections and reconciles: running Attempts with no live process are closed as orphaned; git state is re-read from disk, since git — not the log — owns file contents.

## Consequences

- Pause/resume around Escalations and crash recovery fall out of the design: there are no long-lived in-memory awaits spanning human interaction; handlers append events and the scheduler reacts.
- Every event payload is validated with zod on write and on replay, so the log doubles as the contract between engine, server and UI.
- Schema evolution must be event-compatible: new event types are added, old ones are never reinterpreted. Projections may change freely.
- The engine and server run in one Bun process so `bun:sqlite` has a single writer (WAL mode). Splitting them later requires revisiting this decision.
