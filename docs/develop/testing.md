# Testing

## The two commands

Run both from the repository root before you push:

```sh
bun test packages     # all unit and integration tests (packages/core, runner, engine)
bun run typecheck     # tsc over packages/*, apps/cli and scripts, then a separate pass over apps/web
```

- `bunfig.toml` sets the test root to `packages`, so plain `bun test` does the same thing. The full suite takes a minute or two.
- One file: `bun test packages/engine/src/clarify.test.ts`. One test by name: add `-t "repair turn"`.
- `bun run typecheck` is `tsc -p tsconfig.json --noEmit && tsc --noEmit -p apps/web`. The root `tsconfig.json` excludes `apps/web`, so the web app is checked with its own config.
- `apps/web` and `apps/cli` have no tests of their own. Cover their logic from the engine side, and check UI changes with the [manual QA](#manual-qa-against-a-throwaway-server) below.

## How the tests are built

Tests are colocated with the code as `*.test.ts`. Pure modules (`core/src/machine/*`, `runner/src/stream-codec.ts`, `models/roles.ts`, the skills modules, `git/conventional.ts`, ...) are tested directly. The engine tests are integration tests. They build a **real `Engine`** with a real SQLite store, real git repositories and real worktrees in temp directories. Only the two things that leave the machine are faked: the Claude CLI and GitHub.

```ts
const cfg = (extra = {}) => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, ...extra });
const engine = track(new Engine(cfg(), runner /* fake ClaudeRunner */, gh /* optional fake GhClient */));
const goal = await engine.createGoal({ prompt: 'create done.txt', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
expect(listAttempts(engine.store.db, taskId).map((a) => a.state)).toEqual(['failed', 'passed']);
```

The usual shape: create a goal with `autoBrief` (skips Clarify: one task, the given command checks) or a full `brief`, wait for a state with `waitFor`, then assert on the **read models** (`getGoal`, `listTasks`, `listAttempts`, `listEscalations`, ...) and on **what the engine asked Claude**: `runner.calls` holds every `RunSpec`, with its prompt, model, tools and label.

### Fake runners

All three implement `ClaudeRunner` from `@foundry/runner` and return a `RunHandle` whose `events` is an async generator and whose `result` is already resolved.

**`FakeRunner`**, in `packages/engine/src/test-helpers.ts` (shared) with an older local copy at the top of `engine.test.ts`. It takes `behave(spec, n)`. The callback acts like the session: write files into `spec.cwd` to simulate the worker's edits. `n` counts the attempt sessions so far in that `cwd`, so "fail the first attempt, pass the second" is `if (n >= 2) writeFileSync(...)`. The result is always a `success` costing $0.01. Knobs: `rateLimit` (attached to every result, for Usage Pause tests) and `skillsUsed` (Skill invocations to report).

> **Keep the hook canary.** Its event stream starts with `{ kind: 'hook', name: 'SessionStart:startup' }`. `runAttempt` kills any worker session that reaches `init` without seeing the SessionStart hook (the boundary guard would not be active). A hand-written fake that leaves this event out makes every attempt die.

**`StructuredRunner`**, in `clarify.test.ts`, for sessions whose answer is JSON. `answers(spec, n)` returns the `structuredOutput` for the n-th main call. Calls labelled `classify nature ...` are answered automatically with `classifyAs`. Returning `{ __lost: true }` plays a resume whose conversation no longer exists, to exercise the lost-session path of the Interview.

**`FakeGh`**, in `packages/engine/src/delivery/gh.fake.ts`, used by `delivery/pipeline.test.ts`. It is a scripted GitHub: PRs live in memory, and "merge" fast-forwards the **bare remote's** base branch, so cleanup and verification behave as they would against GitHub. Knobs: `checksSequence` (CI states returned on successive `prView` calls, the last one repeating), `mergeBehavior` (`ok` / `protected` / `fail`), `installed` / `authenticated`, `failedLogText`. `calls` records every command.

### Helpers (`packages/engine/src/test-helpers.ts`)

| Helper | Does |
|---|---|
| `makeRepo(prefix?)` | temp git repo on `main` with one commit (`README.md`) |
| `makeRepoWithRemote()` | `makeRepo` plus a bare `origin` with `main` pushed; returns `{ repo, bare }` |
| `waitFor(pred, ms = 15000)` | polls every 25 ms; throws `timeout waiting for condition` |
| `sh(cmd, cwd)` | runs a shell command, throws on non-zero exit |
| `terminal(state)` | `done` / `over_delivered` / `failed` / `cancelled` |

Skills tests build a fake `~/.claude` with `packages/engine/src/skills/fake-home.test-helper.ts`.

### Cleanup

Every `Engine` a test creates must be **stopped before its temp directories are deleted**:

```ts
const engines: Engine[] = [];
const track = <T extends Engine>(e: T) => (engines.push(e), e);
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true }); // progress folders live next to the repo
});
```

`Engine.stop()` sets `stopped` (so no new tick runs), kills every session the runner owns, waits up to 3 s for `busy()` to reach zero, and settles the per-goal tick chains.

### Known flake: "Unhandled error between tests"

Occasionally a run reports `Unhandled error between tests`. The cause is a background tick or a fire-and-forget piece of work (autoskills, a preview restart, a delivery) from an earlier test. It writes to a store or a temp directory that has already been deleted. It is transient: re-run, and the suite passes.

If it keeps happening in one file, a new test almost certainly creates an `Engine` without `track()`-ing it, or deletes directories before `await engine.stop()`. Don't paper over it with longer sleeps.

## The seeded demo and the guide's screenshots

`scripts/demo.ts` starts a complete Foundry on port 4198 with a scripted runner in place of the Claude CLI. It creates a
throwaway repository and seeds five goals, one in each state a user meets: an interview round, a Brief waiting for
approval, a milestone pause, a running goal and a blocked task. No model is called, so it is free and gives the same
screens every time. Build the web app first:

```sh
bun run web:build
bun scripts/demo.ts           # prints the URL; Ctrl-C stops it and deletes the temp repo and data
```

`scripts/screenshots.ts` starts the same demo, opens each screen in Chrome through Playwright and rewrites every
`docs/guide/images/*.png`. It masks e-mail addresses and temp paths before each capture. Re-run it when a screen that
the guide shows has changed:

```sh
bun scripts/screenshots.ts
```

`packages/server/src/guide.test.ts` keeps the guide honest. It fails when an English page has no 中文 twin or a
different set of sections or screenshots, when a link or an anchor points nowhere, when a screenshot is missing, when a
Settings section has no heading in `settings.md`, or when a "?" link in the app (`<HelpLink to="page#heading">`) opens
a heading that does not exist.

## Manual QA against a throwaway server

Some changes can't be tested with fakes: UI changes, prompt changes, and anything whose real Claude behaviour matters. For those, run a **separate** Foundry and drive it.

**Never QA against your live instance.** `bun run dev` runs the engine under `bun --watch`, so saving any engine file restarts that server. A restart interrupts every running session. `reconcile()` then resumes interrupted attempts as Continuations, and a mid-restart can leave orphaned sessions and duplicate continuations on real goals. Your live instance's `data/` is also real history that you don't want QA goals in.

### 1. Start a throwaway server from its own worktree

The engine's data directory is always `<checkout root>/data`, so a separate git worktree gets its own database, settings, transcripts and model registry:

```sh
git worktree add ../foundry-qa <your-branch>
cd ../foundry-qa
bun install
bun run web:build                       # the server serves apps/web/dist
bun scripts/make-fixture.ts             # optional: fixtures/demo-repo, a tiny repo with a planted bug
FOUNDRY_PORT=4199 bun run serve         # no --watch: edits elsewhere do not restart it
```

- Point the CLI at it with the same variable: `FOUNDRY_PORT=4199 bun run cli status`.
- Use a throwaway target repository, such as the fixture. Progress folders are created next to the target repo (`<repo>-foundry/`).
- The QA server shares your `~/.claude`, so its sessions are real and cost real usage. Prefer `autoBrief` goals, a small Budget, and the Economy preset.
- `data/` starts empty, so the QA server starts with default Settings.

### 2. Drive the UI with Playwright

Playwright is a dependency of `packages/engine`, so run your script **from that directory** so the import resolves. `channel: 'chrome'` uses the Google Chrome you already have installed, with no browser download:

```ts
// qa.ts (throwaway; keep it out of commits)
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
await page.goto('http://127.0.0.1:4199/goals/new');
// ... fill the form, click, wait for text, take screenshots
await page.screenshot({ path: '/tmp/foundry-qa-new-goal.png', fullPage: true });
await browser.close();
```

```sh
cd ../foundry-qa/packages/engine && bun /path/to/qa.ts
```

### 3. Clean up

Stop the server (Ctrl-C), then `git worktree remove ../foundry-qa`, and delete the throwaway repo and its `-foundry` folder.

`scripts/e2e-conflict.ts` is an older scripted end-to-end run (two parallel tasks forced into a merge conflict) against a running server. It honours `FOUNDRY_PORT` / `FOUNDRY_URL`, so run it against the throwaway server too.
