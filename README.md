# ai-engine

A local orchestration system that drives **your host's Claude Code** (subscription login, your skills, your MCP servers) to over-deliver on software goals — Clarify once, then Plan → Act → Observe → Retry automatically, in parallel, inside isolated git worktrees, and only interrupt you for one of five reasons.

Vocabulary lives in [CONTEXT.md](./CONTEXT.md). Why it is built this way: [docs/adr](./docs/adr). What the messages mean while a goal runs (live-log lines, task states, Inbox notices, engine notes, restart rules): [docs/runbook.md](./docs/runbook.md).

## How it works

```
Goal ──► Clarify ──► Brief (you approve once) ──► Tasks (DAG) ──► Goal review ──► local branch
              │                                      │
         explores repo                    per task: Attempt = fresh claude -p session
         graphify / grep                            ├─ Act     (worker role, boundary-guarded)
         planner subagent                           ├─ Observe (command checks + cheap reviewer)
                                                    └─ Retry   (new session + observation report)
                                          parallel tasks: own worktree, merged back; conflicts → Merge Attempt
```

- **Must / Stretch checks.** Must = what you asked for (+ the repo's own quality gates). Stretch = extras the Clarifier proposes and you accept. All Must pass → `done`; Stretch too → `over_delivered`. Nothing is ever added to scope without your approval.
- **Five escalations, nothing else:** a blocking Brief question · a task out of retries · a command that would leave the workspace (`git push`, PRs, deploys — blocked by a PreToolUse hook) · budget exceeded · a denied tool. Everything else is automatic.
- **Output is a local branch** (`goal/<id>` in `data/worktrees/<goal>/_goal`). Pushing is a button you click.
- **Event-sourced.** Every state change is an event in SQLite; the UI streams the same events; the engine recovers from crashes by replay + reconcile.

## Docker

```bash
docker pull imlouiskhenghao/ai-engine:latest
docker compose run --rm ai-engine claude login    # once — the login lives in a volume
AI_ENGINE_REPOS=~/Projects docker compose up -d   # http://127.0.0.1:4111, repos at /repos/<name>
```

The image brings the engine, the UI and the tools it drives (bun, git, `claude`, `gh`, ripgrep, npx, uv); your Claude login and your repositories are mounted. Details and caveats: [docs/docker.md](./docs/docker.md).

## Requirements

- macOS/Linux, [Bun](https://bun.sh) ≥ 1.1, git
- Claude Code CLI installed and logged in (`claude` on PATH). No API key needed — and `ANTHROPIC_API_KEY` is deliberately stripped from child processes.
- Optional: [`graphify`](https://github.com/safishamsi/graphify) on PATH for code-graph context (auto-detected).

## Quick start

```bash
bun install
bun run web:build          # builds the UI into apps/web/dist (served by the engine)
bun run serve              # http://127.0.0.1:4111

# Full flow (Clarify → Brief in the UI → run):
bun run cli goal new "Add CSV export to the orders API" --repo ~/code/my-app

# Skip Clarify: one task + explicit checks
bun run cli goal new "Fix the failing tests" --repo ~/code/my-app --auto-approve --check "bun test" --follow
```

Try it on the bundled fixture:

```bash
bun run fixture                     # creates fixtures/demo-repo with a planted bug
bun run cli goal new "Fix the bug in src/math.ts so tests pass" --repo fixtures/demo-repo --auto-approve --check "bun test" --follow
bun run fixture -- --parallel && bun scripts/e2e-conflict.ts   # two parallel tasks that conflict → Merge Attempt
```

### First run on a new machine

```bash
bun run cli doctor                 # claude installed? logged in? git, bun, graphify, required skills…
bun run cli skills install --tier required    # or: --tier recommended
```

The web UI has the same thing under **Setup** (auto-opens on first run when something is missing) and a **Skills** page that lists every skill Claude Code can see on this machine — user-level (`~/.claude/skills`), plugin-provided, and project-level — with who manages each one (hand-installed, `npx skills` link, gstack clone/copy, plugin, ai-engine), duplicate-name warnings, one-click install from the curated catalog, and reversible uninstall (skills go to `data/skills-trash/`, never `rm -rf`).

The catalog lives in [`catalog/skills.json`](./catalog/skills.json): `required` (the engine is noticeably weaker without it — today just graphify), `recommended` (improves the worker / reviewer / clarifier roles), `optional`. Each entry says *why*. Edit the JSON to curate your own.

**Sources and updates.** The Skills page groups every installed skill by where it comes from — a GitHub repo managed by ai-engine, by `npx skills`, or by a Claude Code plugin; the gstack clone; project skills; hand-installed copies whose origin is inferred by matching their bytes against known sources. For each source it shows when it was installed and when upstream last changed, and per skill whether it is up to date, outdated (its bytes match an older upstream version) or modified locally. *Check for updates* fetches every upstream repository into `data/skills-cache` (deepened to 100 commits so per-skill dates are real). One click updates a whole source with its own tool — `npx skills update`, `claude plugin marketplace update` + `claude plugin update`, or ai-engine's installer — streaming the output and recording every run as a `skills.update_run` event. Loose copies that match a catalog entry can be *adopted* (replaced by a managed install, old copy to the trash); user-level copies that shadow a newer plugin skill are flagged by the doctor and trashed in one click.

**Simple or Expert.** Every goal opens in one of two views of the same engine (choose when creating it; Settings → Workflow sets the default; switch per goal any time). *Simple* shows one plain-language Brief — what the system understood, the questions only you can answer, the assumptions you can veto, the list of what you will get, the price — and, while it runs, a progress bar, the cost and whatever needs you, in plain words. *Expert* shows everything: Areas, the task graph, acceptance checks, Draft/Revise, attempt logs, merge resolution, delivery. Engineering discipline is a per-goal setting too: **TDD required / preferred / off** (Simple goals start with *preferred*; any task can switch it off in the Brief; docs, infra, chore and research tasks never get a TDD mandate).

**Workflow.** ai-engine follows Matt Pocock's engineering workflow ([ADR-0004](./docs/adr/0004-workflow-skills-mandated-and-observed.md)). Catalog entries carry `workflow` rules — worker **must** invoke `tdd` for features and refactors and `diagnosing-bugs` for bugs, the merger **must** use `resolving-merge-conflicts`, the goal reviewer should apply `code-review`'s two axes — and every session gets a `# Workflow skills` section naming the invoke that is actually loaded (plugin copy first). The runner records which skills each session invoked; the task drawer shows them and the task reviewer is told when a mandated skill was skipped (a note, not a blocker). The Setup page has a one-click *Development workflow* card that installs/adopts the bundle. `AI_ENGINE_WORKFLOW=plain` turns this back into the old one-line hint.

**Scenarios and design packs** ([ADR-0005](./docs/adr/0005-scenario-skills-and-settings.md)). The Clarifier labels every task with a *scenario* (frontend, backend, fullstack, data, mobile, infra, docs, general) and catalog rules can be bound to scenarios. UI tasks get a **design pack** as a MUST — choose it on Setup or Settings: ui-ux-pro-max (default; a plugin the engine can install with `claude plugin`), Anthropic's frontend-design, [impeccable](https://github.com/pbakaus/impeccable), the [bencium](https://github.com/bencium/bencium-marketplace) pack (impact-designer + design-audit + typography) or [garden](https://github.com/ConardLi/garden-skills)'s web-design-engineer. Packs are mutually exclusive: only the chosen one is shown to sessions, and the goal reviewer gets its review counterpart (`/impeccable critique`, `design-audit`, ui-ux-pro-max's UX guidelines).

**Project skills (autoskills).** When a goal's Brief is approved, the engine runs [`npx autoskills`](https://www.autoskills.sh/) in the goal workspace (needs Node ≥ 22 and a stack manifest such as `package.json`): it detects the stack and installs matching skills into the workspace's `.claude/skills`. The engine then restores `CLAUDE.md` (autoskills rewrites it), adds the new skill dirs and `skills-lock.json` to the repository's `.git/info/exclude` — note this exclude is shared by all worktrees of that repository, your own checkout included — copies the skills into task worktrees, and tells every worker which project skills are loaded. Off switch: Settings → Workflow → autoskills.

### Creating a goal

The New Goal page is four steps. **Goal** — describe it and attach what words cannot carry: screenshots, PDFs, files or links (drop, paste or pick; ≤ 25 MB each, kept under `data/attachments/<goal>/`, handed to every session of the goal as read-only references, never copied into the repository). When [markitdown](https://github.com/microsoft/markitdown) is installed (Setup has a one-click `uv tool install`), PDFs, Office files, HTML, EPUB… are converted to markdown on upload and links are snapshotted as markdown, so sessions `Read` one `.md` instead of rendering PDF pages as images or spending a WebFetch — far fewer tokens. Workers are also told to run `markitdown <file>` on documents they meet inside the repository. Click an attachment to open it: the *Markdown* tab shows exactly what sessions read, the *Original* tab shows images, PDFs and text inline (other types open in a new tab). **Repository** — *Select folder…* opens a folder browser (recent repositories, well-known places, git badges; on macOS also the native Finder dialog); the panel under it shows branch, commits, remotes and identity, offers one-click `git init` when needed, and prefills Delivery from what it finds. **Budget** — presets: *Auto* (default: no cap while clarifying; the Brief's estimate ×2 is proposed and you confirm or edit it before approving), *Quick*, *Thorough*, *Unlimited*, *Custom*. **Delivery** — see below.

**The Brief.** Clarify ends with one document you approve once. The Clarifier first lists the **Areas** the goal covers (one per user-facing role or app it names — student portal, teacher portal… — plus a *shared* Area for groundwork), then plans **1–6 tasks per Area** (no cap on the total; above 12 the page warns that the goal is large). Every task, goal-level check and question carries its Area; the engine checks that every Area has at least one task and sends the Clarifier back once when one is missing — a gap that remains becomes a question on the page. The Brief page shows the task graph (coloured by Area) and lists the tasks by **Stage** (a stage's tasks run in parallel; a stage starts when the previous one is done); each task card has a *runs after* picker, its kind / scenario / Area / commit scope (blank = the Area's slug), its spec, and its own acceptance checks (Command = a shell command that must exit 0, Reviewer = a Claude session judging the diff against a rubric; switch the type, toggle must/stretch, move a check between task and goal level). Goal-level checks sit in their own card, grouped by Area. **Draft with AI** on a task you added drafts its spec, attributes, dependencies and checks from the Brief and a read-only look at the repository (≤ $2, strong model); on a task that already has a spec it only *suggests acceptance*; an Area with no tasks offers *Draft tasks for this Area*. Everything comes back as a proposal you accept item by item — nothing you typed is ever overwritten. **Decisions.** Your answers to the Brief's questions and the assumptions you untick are *decisions*: every worker, the goal reviewer and the PR body receive them verbatim, and a re-run Clarify starts from them instead of asking again. Because the tasks were planned before you decided, the Decisions card offers **Revise with answers** (≤ $3): the Clarifier re-reads the Brief and the repository and returns a diff — changed, added or dropped tasks, checks and Areas — that you accept item by item; until then the page flags "N decisions not applied to the plan", without blocking approval.

**Sessions carry on instead of starting over.** A worker session that is cut — by an engine restart, its per-session turn or cost cap, or a timeout — is *resumed* (`claude --resume`, full context kept) rather than replaced by a fresh attempt that has to understand the task again; so is a session whose checks still fail but that made progress (it committed something and is not getting worse): it gets the check report and carries on. Up to `sessions.maxContinuations` (default 2) per attempt, none of which count as retries; after that, or when nothing moved, the old fresh-attempt-with-observation-report path takes over. A Merge Attempt's second try resumes the first. Task view shows `↻n` on continued attempts.

**Fewer conflicts in the first place.** Three things keep parallel tasks from colliding: the scheduler never runs two tasks at once when their `relevantFiles` overlap (same file, or one inside the other's directory), whatever the Brief says — the waiting task gets a note; before every attempt and again right before landing, a task in its own worktree **catches up** with the goal branch (other tasks' commits are merged into the task branch, cleanly or through a Merge Attempt that has the task's context; if even that fails the worker is told to merge by hand), so a retry builds on current code and the final squash cannot conflict; and Merge Attempts are judged on *regressions* only — must checks that were already red on the goal branch before the merge (computed once per commit in a throw-away `_baseline` worktree) do not count against a correctly resolved merge. The planner is also told to keep shared registries (`schema.gql`, navigation configs, barrels, Prisma migrations) for one later, non-parallel wiring task.

**Merge conflicts you resolve yourself.** When two tasks touch the same lines, the engine runs up to two Merge Attempts (a strong-model session that edits the conflicted files, then the must command checks). If they give up, the task is blocked and the Inbox entry says exactly why each attempt failed (conflicts left vs. checks failing) — and offers **Resolve manually**. That page re-creates the conflict in a separate `_resolve` worktree (the rest of the goal keeps merging), lists every conflicted file with *ours* (goal branch) and *theirs* (task branch) side by side, and lets you take a side, take both, edit the result in the browser, or open the worktree in your editor. *Finish merge* commits the resolution as the task's Conventional Commit, runs the must checks (with a *Finish anyway* escape hatch), lands it on the goal branch and marks the task done; the escalation is answered by the act of finishing.

**Stale checkouts.** Your local `main` is often behind `origin/main`. Before a goal explores the repository the engine runs `git fetch origin main` (remote-tracking refs only — your working tree and branches are untouched) and, when the local base is strictly behind, starts the goal branch from `origin/main` instead; the Clarifier explores that worktree. The Repository card shows the gap ("3 behind origin/main — the goal will start from origin/main") with a *pull into my checkout* button that fast-forwards your branch (refused when you have uncommitted changes or the branches diverged). Diverged or ahead-with-unpushed-commits → the goal starts from local and delivery's sync-with-base merges the remote. While a Brief awaits approval, **Re-run Clarify** (Brief page, or the Goal page's ⋯ menu) throws the goal worktree and Brief away, fetches again and lets the Clarifier explore the fresh tip — attachments, budget and delivery policy are kept. Settings → *Sync with upstream* (`fetchBeforeGoal`, `startFrom`, and an off-by-default *refresh between tasks* that merges a moved base into the goal branch whenever nothing is running).

On the Goal page, **Open ▾** launches the repository checkout, the goal branch worktree or a task worktree in whatever is installed (VS Code, Cursor, Zed, Windsurf, Finder, Terminal, iTerm, Warp) or copies the path; the engine only opens directories it resolved itself.

### Delivery: git init → GitHub → PR → CI → merge

Per goal you choose a **delivery policy** (New Goal page, or later via *Deliver…* which first shows the exact plan):

| mode | what the engine does once the goal is done |
|---|---|
| `local` (default) | nothing leaves the machine |
| `push` | sync with the base branch (conflicts → Merge Attempt), push `goal/<id>` |
| `pr` | …then open a pull request whose body is the Brief + check results |
| `pr-automerge` | …wait for CI, fix it once if red (bounded task), merge when green, delete the remote branch |

**Granularity.** Each policy has a *unit*: `goal` (one branch / one PR for everything) or `task` (the default for new goals: one PR per task). Every finished task becomes exactly one commit on the goal branch — the engine squashes its attempts and writes a [Conventional Commits](https://www.conventionalcommits.org) message (`feat(scope): subject`, type from the task kind, scope and subject from the Brief); sync merges and the initial commit of a fresh repo follow the same standard, and the model never commits. With `unit: task` the delivery re-applies those commits one by one on top of the remote base branch into `goal/<id>-1-<slug>`, `goal/<id>-2-<slug>`, … and opens one PR per branch, each based on the one below and titled with the commit header (PR body: task spec, its checks, reviewer note, position in the stack). Auto-merge walks the stack bottom-up: retarget the PR to the base, bring the base in, wait for CI, merge, then retarget the PR above it *before* deleting the merged branch (GitHub closes a PR whose base branch disappears). A re-run after a failure resumes where it stopped: merged tasks are skipped, branch positions are stable, an open PR is reused, a closed one is reopened or — when GitHub refuses — replaced by a fresh PR from the same branch. A commit that cannot be re-applied (even after a Merge Attempt) makes the engine fall back to one PR for the whole goal and record a `delivery.note`. The one-PR title is the Brief's title (editable on the Brief page).

Rules that never bend: the model stays inside its worktree (hook), only the engine touches the remote, never `--force`, never a direct push to the base branch, every remote command is logged as a `delivery.command` event. A repository without git gets a one-click `git init` + initial commit; one without a remote can be created on GitHub (owner/org picker). GitHub identity is the official `gh` CLI — `ai-engine github login` / Connect GitHub runs its device flow; no token is stored by ai-engine. Without `gh`, `push` to an existing/URL remote still works.

### Usage & rate limits

**Usage** (header pill + `/usage` page, `bun run cli usage`) is a small dashboard of what ai-engine itself has consumed: the current 5-hour and 7-day windows (cost, tokens, elapsed-time bar, reset countdown, cost per hour / per day), cache hit rate, average cost and length per session, failed sessions, and breakdowns by goal (with titles), session kind and model, plus the last rate-limit signal from the CLI (`allowed` / reset time). When a session reports that the subscription is rate-limited, the engine stops starting new sessions until the reset time and resumes by itself. Subscription plans expose no usage API, so these are ai-engine's own numbers, not your account percentage — run `/usage` inside Claude Code for that. We never read your credentials.

### CLI

```
serve                                    start engine + server
goal new "<prompt>" --repo <path> [...]  create a goal (--preset auto|quick|thorough|unlimited, --max-cost N|none, --auto-approve, --check, --follow)
status [goalId]                          goals overview / one goal's tasks, attempts, checks
brief <goalId> [--approve]               print / approve the Brief
escalations · answer <id> <action>       inbox from the terminal
watch <goalId> · diff <goalId> · cancel <goalId>
replay --verify                          rebuild read models from the event log and compare
doctor · skills list|catalog|install|uninstall|restore|update|trash · usage [--probe]
```

## Configuration

The **Settings** page (`/settings`, API `GET/PUT /api/settings`) edits everything below and saves only what you changed to `data/settings.json`. Precedence per value: saved › environment variable › default — the page shows where each value comes from. Most settings apply immediately (concurrency, models, session caps, workflow profile, design pack, autoskills, review and delivery defaults, tools, safety); `port`, `host`, `claudeBin` and `claudeHome` take effect after `bun run serve` is restarted (the page and `/api/health` say so).

**Models over time.** Settings → Models lists what this machine has seen resolve (a learned registry, `data/models.json`, fed by every session's `init` message) plus the family aliases; a new Claude family is one "custom" entry away and shows its resolved id after the first session (or after *Test*, one short paid call). When a model turns out to be unavailable — deprecated alias, retired id — the session is re-run with the next model of the fallback chain and the goal's model is updated (`goal.models_changed`, shown on the Goal page); the Doctor warns about tiers that never resolved here or failed last time ([ADR-0006](./docs/adr/0006-model-registry-and-fallback.md)).

Environment variables seed the initial values (handy for CI or a one-off run):

| var | default | meaning |
|---|---|---|
| `AI_ENGINE_PORT` / `AI_ENGINE_HOST` | `4111` / `127.0.0.1` | server listen address (restart) |
| `AI_ENGINE_MAX_CONCURRENT` | `3` | global cap on concurrent `claude` processes |
| `AI_ENGINE_CLAUDE_HOME` (or `CLAUDE_CONFIG_DIR`) | `~/.claude` | Claude Code home: skills, plugins, settings.json (restart) |
| `AI_ENGINE_MODEL_WORKER` / `_STRONG` / `_CHEAP` | `opus` / `opus` / `haiku` | model per tier — `fable`, `opus`, `sonnet`, `haiku` (Claude Code aliases) or a full model id. *strong* = Clarify, Planner, Goal review, Merge Attempts; *worker* = task attempts; *cheap* = task reviewer, probes |
| `AI_ENGINE_MODEL_FALLBACKS` | `opus,sonnet,haiku` | tried in order when a session's model is unavailable (deprecated alias, retired id) — see [ADR-0006](./docs/adr/0006-model-registry-and-fallback.md) |
| `AI_ENGINE_ATTEMPT_MAX_COST` / `AI_ENGINE_ATTEMPT_MAX_TURNS` | `10` / `150` | per-session cost (USD) and turn caps for a worker attempt; cost is also bounded by the goal's remaining budget |
| `AI_ENGINE_WORKFLOW` | `mattpocock` | `plain` disables mandated workflow skills (one-line hint only) |
| `AI_ENGINE_DESIGN_PACK` | `ui-ux-pro-max` | design pack for UI tasks: `ui-ux-pro-max`, `frontend-design`, `impeccable`, `bencium`, `garden`, `none` |
| `AI_ENGINE_AUTOSKILLS` | `true` | run autoskills per goal (`0`/`false` to disable) |
| `AI_ENGINE_DELIVERY_MODE` | `local` | default delivery policy for new goals |
| `AI_ENGINE_SYNC_FETCH` / `AI_ENGINE_SYNC_START` / `AI_ENGINE_SYNC_REFRESH` | `true` / `auto` / `false` | fetch the base before a goal; start from the remote tip when local is behind (`auto`) or always local; refresh between tasks |
| `AI_ENGINE_MARKITDOWN` | auto-detect | path to the markitdown binary |

Per-goal budgets (cost, minutes, concurrency, attempts per task) are set when creating the goal and can be raised from the Inbox when exceeded.

Roles (prompts) are plain markdown in [`roles/`](./roles) — edit them without touching code: `clarifier`, `planner`, `worker`, `reviewer-task`, `reviewer-goal`, `merger`.

## Layout

```
packages/core     zod schemas, event log (bun:sqlite), projections, state machines, DAG
packages/runner   ClaudeRunner interface + ClaudeCliRunner (spawns `claude -p --output-format stream-json`), boundary hook
packages/engine   scheduler, attempt loop, checks, reviewers, merge, clarify, budgets, escalations, context providers,
                  attachments, fs/ (folder browser, native picker), delivery/ (git init, gh, pipeline),
                  skills/ (scanner, catalog, installer, trash, doctor, sources, updates, updaters, workflow), usage/ (ledger, rate-limit pause)
catalog/          skills.json — curated required / recommended / optional skills
packages/server   Hono API + WebSocket + static UI
apps/web          React UI (goals, new goal, brief review, run view, inbox)
apps/cli          thin CLI
roles/            versioned role prompts
data/             runtime: engine.db, transcripts/, worktrees/, check-output/ (gitignored)
```

## Token economy (by design, not by tooling)

- every Attempt is a fresh session that receives a distilled *Observation Report*, never the previous transcript
- task specs carry only relevant files / graph excerpts (graphify when available, ripgrep otherwise)
- strong model for planning/coding/goal review, cheap model for task reviews and output distillation
- check outputs are truncated/distilled by the engine before they reach a model
- `rate_limit_event` from the CLI is surfaced live; cost is tracked per goal against a budget

## Development

```bash
bun test                 # unit tests (core, runner, engine)
bun run typecheck
bun scripts/spike-runner.ts   # raw runner spike against the real CLI
bun scripts/spike-guard.ts    # boundary hook + permission-denial spike
```
