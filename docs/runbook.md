# Runbook — what you will see, what it means, what the engine does about it

> [中文](./runbook.zh.md) · English

A field guide to the messages Foundry shows while a goal runs. Vocabulary is in [CONTEXT.md](../CONTEXT.md); design decisions in [adr/](./adr). Everything here is normal operation unless marked **act**.

## 1. Lines in a task's Live log

| You see | Meaning | Engine / you |
|---|---|---|
| `● session 1a2b3c4d · claude-…` | A worker Claude session started (or was **resumed** — a second `●` in the same attempt is a Continuation). The task reviewer and merger appear as `● reviewer session …` / `● merger session …`. | — |
| `[claude-code:unrecognized_model] {"model":"claude-fable-5-1",…}` | Your Claude Code is older than the model you picked (e.g. Fable 5.1 needs 2.1.259); the request still goes through and the session is fine. | Update Claude Code (`npm install -g @anthropic-ai/claude-code`) to silence it; in Docker, pull the newest image. |
| `[reviewer] …` lines after the worker finished | The task reviewer (cheap model) judging the diff. It shares the attempt's log. | — |
| `[reviewer] ✗ Output does not match required schema: root: must have required property 'pass' …` | The reviewer called the structured-output tool with the wrong shape (usually the JSON wrapped as a string). Claude Code rejects it; the reviewer resends correctly. Costs a retry of the cheap model, nothing else. The attempt's verdict is unaffected. | Prompt now states the exact shape; if you still see it often, raise it. |
| `✗ Exit code 1 … (eval):cd:1: no such file or directory: apps/x` | *Historical.* The Bash tool kept the previous `cd`. Fixed: every command now starts from the workspace root (`CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`). | If it reappears, the engine's env is not reaching sessions. |
| `■ error_max_turns` / `■ error_max_budget_usd` | The session hit its per-session cap before finishing. | **Continuation**: the same session is resumed with a fresh allowance (up to `sessions.maxContinuations`). |
| `■ killed_timeout` / `■ killed_idle` | The session ran out of wall-clock / was silent too long. | **Continuation** with a "timed out" message, up to `sessions.maxContinuations` (default 2) like the caps above; then a fresh attempt. |
| `⏳ rate limit rejected` | Claude's 5-hour / weekly limit. | Scheduling pauses until `resetsAt`; nothing is killed, nothing is lost. |
| `# The goal branch moved while this task was waiting` (in the Prompt tab) | Other tasks landed meanwhile; the engine merged them into this task's worktree first (Catch-up). | — |
| `# The goal branch moved and the automatic merge could not finish` | Catch-up hit a conflict the Merge Attempt could not resolve. | The worker is told to `git merge` the goal branch itself, keeping both intents. |

## 2. Attempt states and markers (Task view)

Each attempt shows a **stat grid** (Result · Worker model · Turns · Cost worker + reviewer · Started · Duration · Session · Skills) and a **Sessions table**: one row per Claude session that ran for it — worker segments (continuations are extra rows), the task reviewer (cheap model, shows as `reviewer`), mergers. *"Why does the log show another model?"* — that row. The **Task total** strip above sums every attempt and every session (worker / reviewer / merger), so the cost you see is the task's real cost, not the last attempt's.

| Marker | Meaning |
|---|---|
| `#3 ↻1` | Attempt 3 was continued once (session resumed). Cost and turns are cumulative over segments. |
| `interrupted` | Cut by an engine restart; resumes as a Continuation at the next scheduling pass. No retry consumed. |
| `→ 2 file(s) still conflicted (src/a.ts, src/b.ts)` / `→ conflicts resolved but must checks regressed — …` | Why a Merge Attempt failed. |
| `→ all must checks passed` | — |
| `passed` but task still `merging` | Landing on the goal branch: catch-up, squash, checks. |

## 3. Task states and their reasons

Task states: `pending` (waiting on the tasks it depends on) → `ready` (could start) → `running` (a session is working) → `observing` (checks + reviewer judging the segment) → `merging` (landing on the goal branch) → `done`. Off the happy path: `blocked` (an escalation needs you), `failed` (a task it depended on failed, or a new delivery run superseded it), `skipped` (you skipped it, or restarted a task downstream of it).

| State / reason | Meaning | Engine / you |
|---|---|---|
| `ready` · *"X is not parallelizable; it starts when Y finishes"* | Brief marked the task serial. | Waits for quiet. Make it `parallelizable` in the Brief next time if it need not wait. |
| `running` · *"retry 2/3"* | The normal fresh-attempt path after a failed attempt. | — |
| `running` · *"continuation 1: max turns / max budget / timeout"* | The session hit a cap but is resumed (not a retry). | — |
| `ready` · *"X waits for Y: both touch src/shared/schema.gql"* | Declared `relevantFiles` overlap with a running task. | Runs when Y is done — avoids a merge conflict. |
| `running` · *"resuming attempt 2 after the engine restart"* | Continuation after a restart. | — |
| `running` · *"continuation 1: checks failed"* | Checks failed but the segment made progress; same session told what still fails. | — |
| `ready` · *"engine error (1/3), retrying: …"* | The engine itself threw (not the model). | Retries twice without consuming attempts; the third time the task goes `blocked` → Inbox with `kind: engine`. |
| `blocked` · escalation `retries_exhausted` | Out of attempts (see §4). | **act** |
| `merging` for a long time | Merge Attempts (up to 2, then the human) and must checks run here. | See §4 if it ends in the Inbox. |
| `done` · *"no changes to commit"* | The task's work was already on the goal branch (landed via another route). | — |
| note *"worktree of X is missing (…); recreating it from the goal branch"* | Its worktree was dropped (finished earlier, then restarted). | Recreated from the goal branch. |

## 4. Inbox notices

Every notice names the goal and the task and links straight to the task view; the same card is shown inside the task.

| Notice | Meaning | What to do |
|---|---|---|
| **Retries exhausted · merge conflict** — lists files and *why each attempt failed* | Two tasks changed the same lines; two Merge Attempts could not land it (or landed it but must checks regressed). | **Resolve manually →** (both sides per file, take a side / edit / open in your editor, Finish merge). Or *Retry with hint* ("merge the goal branch first, keep Postgres…"), or *Skip task*. |
| **Retries exhausted** — *"used N/M attempts; Must checks still failing"* + the last observation report | The worker could not make the checks pass. | **Suggest a hint** (AI reads the task, the failing checks and the last session, explains the cause in plain words and fills the hint — you press *Retry*), or **Let AI handle it** (same, and when the answer is "retry with this hint" it is applied at once; skip / budget / manual merge are never applied for you). Or decide yourself: *Retry with hint* / *Skip task*; a wrong check → fix it in Expert view. |
| **Retries exhausted · engine** — *"Engine error … 3 times in a row"* | Foundry bug or environment problem (git missing, disk). | Fix the cause, then *Retry*. Please report it. |
| **Budget exceeded** | Cost or time limit reached. | *Raise budget* or *Abort*. |
| **Wants to leave the workspace** | A session tried `git push` / deploy / paid service. | *Approve & run once* or *Deny*. |
| **Tool denied** — *"the task failed and Claude was denied: &lt;tools&gt;"* | The last attempt failed and Claude refused a (non-boundary) tool call. | Same choices as *Retries exhausted*: **Suggest a hint** / **Let AI handle it**, *Retry with hint*, *Skip task*. |
| **Retries exhausted · goal review** — *"Goal review failed after N fix cycle(s). Failing Must checks: …"* + the reviewer's notes | The merged result failed reviewer-type Must checks after its fix cycle(s). The reviewer's findings ride on the escalation. | **Retry with hint** turns those findings into fix tasks (your hint goes with them), runs them and reviews again — it never just re-rolls the same review. **Accept as-is** finishes the goal with the failing checks waived. A re-review sees the previous verdicts and may flip one only for a reason it cites. |
| **Retries exhausted · goal review crashed / delivery** | The goal review crashed (`kind: goal-review`, no findings), or CI on a delivered PR could not be fixed within the task's attempts (`kind: delivery-fix`). | *Retry* after fixing the cause (re-runs the review); a delivery-fix can be re-run with *Deliver* again. |
| **Brief question** | Only on the Brief page. | Answer; then *Revise with answers* if it changes the plan. |

## 5. Engine notes worth knowing

| Note | Meaning |
|---|---|
| *baseline at abc1234: N must check(s) already failing on the goal branch … merges are judged on regressions only* | The goal's own suite is red independent of the merge. A correctly resolved merge is not blocked by it. Fix the suite (goal review will), but merges keep flowing. |
| *merge attempt 1 for task/…: N must check(s) fail but already failed on the goal branch before the merge — accepted* | Same, applied. |
| *catch-up: merged N goal-branch commit(s) into task/… before "…"* | Task worktree brought up to date before work / before landing. |
| *N skill(s) installed for this stack (content in .agents/)* (the `goal.autoskills` detail, on the Goal → Project skills card) | The stack's project skills were installed as symlinks into `.claude/skills`; both the links and their target dir are git-excluded so they never reach a commit. |
| *…; N stale tracked link(s) removed from the index* | An older run let those symlinks into git; they are dropped from the index (files stay on disk). If a branch already carries them, clean it with `git rm -r --cached .claude/skills && git commit`. |
| *catch-up: task/… has an unfinished merge with conflicts … leaving it for the worker* | An earlier session left a merge open; the worker is told to finish it. |
| *attempt … was interrupted by an engine restart; its session will be resumed* | Continuation after restart. |
| *attempt … was orphaned by an engine restart* | Could not be resumed (no session yet); a fresh attempt runs, budget refunded. |
| *"…" waits for "…": both touch …* | Overlap-aware scheduling (§3). |
| *model X is unavailable (…); worker sessions of this goal now use Y* | Model fallback chain kicked in. Check Settings → Models. |
| *Setup → Sign in asks for a code* | The machine running the engine has no browser (Docker, a remote host), so Claude Code falls back to the copy-the-code flow: open the link it shows, approve, paste the code into the dialog. A wrong code re-opens the field; the sign-in waits 15 minutes. |
| *coverage repair did not return a valid Brief …* | The Clarifier missed an Area and the repair turn failed; the gap is a Question on the Brief. |
| *usage limit reached (five_hour/weekly): paused until … ; goals resume automatically* | A Claude usage window is exhausted. Nothing is killed; new sessions wait. Goals, Goal and Inbox pages show an amber banner; the pause survives an engine restart (re-armed from the event log) and lifts itself at the reset time. |
| *usage limit reset — goals resume* | The pause above ended; every non-terminal goal was ticked. |
| *Foundry &lt;version&gt; is available* (header pill + notification) | The daily check found a newer release. `update.available` fires once per version. | Open the pill or Settings → About & updates to see the changelog and update. See §7. |
| *autoskills: skipped — no stack manifest … retried after each task until one appears* | Empty-repository goal: nothing to detect yet. After each task lands the engine checks again; the task that creates package.json (or another manifest) triggers the install, and live task worktrees receive the skills. |
| *graph refresh: graphify ok, gitnexus skipped* | Completion action after the goal was delivered (or at done for local goals): `graphify update` (and `gitnexus analyze` when installed) re-indexed the delivered code. `skipped` = tool not on PATH. A separate *pull --ff-only … : …* note reports whether the user's checkout could be fast-forwarded first (dirty/diverged = it was not, and the refresh ran where it could). |
| *docs generation failed: …* | The Documenter session (after goal review, before done) failed; the goal still finishes. Details on `goal.docs_generated` and the Goal → Completion card; re-run by restarting the last task is not needed — docs can be written by hand or the goal restarted from goal review. |
| *N artifact(s) delivered to …* | A media goal finished: the workspace's `artifacts/` was copied to the goal's output folder (`goal.artifacts_delivered`). No output folder set → the files stay in the goal workspace (Open ▾ → The result). |
| *artifact delivery to … failed: …* | Copying artifacts to the output folder failed (permissions, missing disk). The goal still finishes; the files are intact in the goal workspace — copy them by hand or fix the folder and restart delivery is NOT needed. |
| *[artifacts] task…: N file(s) copied to the goal workspace* (a server-log line, not a UI note) | A media task integrated: its worktree's git-excluded `artifacts/` was rescued into the goal workspace before the worktree was dropped. |

## 6. What costs money, what does not

- **Sessions** (worker, reviewer, merger, clarifier, goal reviewer, draft/revise) cost; everything the engine does in git, checks and worktrees is free (time only).
- **Continuations are cheaper than attempts**: a resumed session reuses its context (prompt-cached); a fresh attempt re-reads the repository. That is why cut sessions and progressing sessions are resumed first.
- **Baseline checks** run the goal's must commands once per goal-branch commit in a throw-away worktree — time, not tokens.
- Session caps: **Clarify** ≤ $6, **Draft with AI** ≤ $2, **Revise with answers** ≤ $3, a **Merge Attempt** ≤ $2, the **goal reviewer** ≤ $2, the **Documenter** ≤ $3 (only when the goal's Completion docs are on), a **Style sample** ≤ $0.5 per click (max 8 per direction; earlier samples are kept), the **AI hint** for an escalation ≤ $1, a **task reviewer** ≤ $0.8. Worker attempts use `FOUNDRY_ATTEMPT_MAX_COST` (default $10), bounded by the goal's remaining budget. The graph refresh is free (no LLM). **Fast-pace goals** skip the free task/goal reviews and generated docs entirely — approved checks still run. The Usage page has the per-kind ledger.

## 7. Updating and restarting the engine safely

**Prefer the built-in update over a manual restart.** Settings → About & updates (or the header pill) checks the release registry daily; *Update* drains first — it stops starting new sessions and waits for the busy ones to finish (up to an hour; the *Update immediately* checkbox interrupts them instead), then replaces the binary (Docker: the watchtower sidecar; local: `git pull --ff-only && bun install && bun run web:build`, rolled back on any failure) and restarts. A rolled-back update leaves you on the old version. `FOUNDRY_UPDATE_CHECK=off` turns the daily check off. Under a service manager, set `FOUNDRY_SUPERVISED=1` so the updater exits and lets launchd/systemd bring the new version up (see [remote-access.md](./remote-access.md)).

If you do restart by hand:

1. `GET /api/health` → `active` (= `busy.total`) must be `0`, or you will interrupt sessions. (Interrupted **work** sessions that already have a session id resume as Continuations, but the segment in flight is paid twice; a merge session or a session cut before it started over is orphaned and costs a fresh attempt.) The goal's *state* does not matter — a `running` goal with `active: 0` (waiting on a serial task, or rate-limit `pausedUntil`) is safe.
2. **Never restart mid-delivery**: `busy.delivering` must be `0`. A restart during delivery marks it failed (*"engine restarted during delivery — run Deliver again"*); every delivery step is idempotent, so just press *Deliver* again.
3. `restartNeeded` on `/api/health` lists the settings whose change is waiting for a restart (`port`, `host`, `claudeBin`, `claudeHome`).
4. After schema changes that add defaulted fields: stop, `bun apps/cli/src/main.ts replay`, then `replay --verify` (must print *identical*), then start.
5. Kill the right process: `pgrep -f "^bun apps/cli/src/main.ts serve"` — never `lsof -ti :4111 | head -1` (that can be the browser).

## 8. Things that still need a human

- Semantic conflicts (each side's tests pass, the combination is wrong) — caught by goal-level checks and the Goal reviewer, fixed by fix tasks or you.
- A task that edits a shared file it did not declare in `relevantFiles` — the scheduler cannot see the overlap; catch-up and Merge Attempts handle the resulting conflict, manual resolution is the last resort.
- A goal whose suite is red for unrelated reasons: merges flow (baseline), but the goal cannot finish until the suite is green — the goal review's fix task or you.

## 9. Image goals need an image backend

- Image generation only *runs* when sessions see an `OPENAI_API_KEY` (any OpenAI-compatible endpoint; `OPENAI_BASE_URL` overrides the host) or a `GEMINI_API_KEY` (used by the `claude-image-gen` pack by default). Without a key the skill degrades to advisory mode and workers hand-author SVG/HTML renders — noticeably lower fidelity.
- The normal way to provide a key is **Settings → Tools & keys** (*OpenAI-compatible API key* or *Gemini API key*): stored in `data/settings.json`, applied to the next session immediately — no restart. Alternatively put it in `.env` at the repo root (gitignored; Bun loads it when the engine starts). Either way sessions inherit it — the key is visible to every session.
- When the key is missing you will see it: the skills Doctor warns (*gpt-image-2 backend*), the worker's prompt carries a ⚠ degraded-mode note, and the Clarifier records an explicit assumption on image goals so you can reject it before approving the Brief.
