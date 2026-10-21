# Run Foundry with Antigravity

Foundry can drive Claude Code, Codex CLI or the Antigravity CLI (`agy`, Google's successor to the Gemini CLI). All three share the goal, interview, Brief, worktree, acceptance-check, review and delivery engine; the launch profile selects defaults and the data directory, and each new goal picks its coding agent, which all of its sessions keep.

## Shared engine, what Antigravity brings

| Shared within one Foundry instance | Scoped to Antigravity |
| --- | --- |
| Goals, Briefs, worktrees, checks, reviews, delivery and event history | The native CLI process, conversation ids and the account it signed in with |
| Global concurrency budget and notifications | One model and one reasoning effort for every role; `agy models` fills the list |
| One Settings page and the same Coding agent selector | Skills installed in the shared `~/.agents/skills` and linked into each goal's workspace; plugins and MCP servers managed in agy itself |
| One Usage page and Agents monitor | Token counts and the account's weekly quota per group of models (no USD cost) |

## From source

Install Bun and git, then the Antigravity CLI (1.1.15 or newer: print mode with stream-json input) and sign in once from a terminal, which opens the browser:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash   # or: brew install --cask antigravity-cli
agy                                                            # sign in, then /quit
bun install --frozen-lockfile
bun run web:build
bun run serve:agy
```

Open <http://127.0.0.1:4111>. Setup checks **Antigravity CLI** and **Antigravity sign-in**; the Accounts page shows the account the CLI is signed in with and says to run `agy` in a terminal when it is not. Foundry drives neither the sign-in nor the sign-out (`/logout` inside agy). A `GEMINI_API_KEY` works the way the CLI documents it: `modelProvider: gemini` in `~/.gemini/antigravity-cli/settings.json` and the key in the environment Foundry starts with.

`bun run dev:agy` starts the development watcher. The equivalent production command is `FOUNDRY_PROVIDER=agy bun run serve`. The Antigravity launch profile defaults to `data-agy/`; set `FOUNDRY_DATA_DIR` for another place. Existing goals keep their backend.

## Models and configuration

Settings → **Models & limits** → **Coding agent → Antigravity** holds the **Antigravity model** every role of a new goal runs on (**Antigravity default** follows the model the CLI itself is set to; **Sync models** lists the account's models with `agy models`, which runs no model) and the **Reasoning effort** (low, medium, high, xhigh or max). A goal snapshots both at creation; the **Models** list on the New goal page or `--agy-model` on the CLI pins another model for one goal, and follow-ups, delegated parts and scheduled runs keep it. There are no presets and no fallback order: the CLI refuses an unknown model outright, and the session fails.

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_PROVIDER=agy` | Select Antigravity at startup |
| `FOUNDRY_DATA_DIR` | Override the backend's default data directory |
| `FOUNDRY_AGY_BIN` | Antigravity executable; defaults to `agy` on PATH |
| `FOUNDRY_AGY_MODEL` | The model of every role; defaults to `agy-default` |

Saved settings override the corresponding environment defaults; a changed binary needs a restart.

## Permissions, skills and accounting

- Every session runs with `--dangerously-skip-permissions` under Foundry's own guard: a `PreToolUse` hook in the workspace's `.agents/hooks.json`, added for the session and taken out after it (your own entries stay; the file is git-excluded). It keeps the boundary (no push, PR, deploy or publish from a session), denies the file tools to read-only roles, refuses agy's own subagents (Foundry runs the roles), and counts tool calls against the session's allowance, three per turn of its turn cap (agy calls a tool for every file it reads). A `SessionStart` and a `PreInvocation` hook write the session canary (a resumed conversation starts no session); a session whose canary never appears is stopped before it works.
- Read-only roles are enforced on the file tools only; a shell command can still write. Codex has an operating-system sandbox for this; Antigravity's `--sandbox` is undocumented in its effect and is not used.
- Antigravity reads skills only from the workspace's `.agents/skills`; agy 1.4.4 does not read `~/.agents/skills`. Setup and **Extensions → Antigravity** install, update and trash its skills in the shared `~/.agents/skills` (Codex and the community `skills` CLI read the same folder), and before each session Foundry links the installed ones into the workspace, git-excluded, beside the workflow suite's skills and the Learnings notebook. autoskills writes the same layout.
- Plugins and MCP servers are managed in agy itself (`agy mcp add`, `agy mcp list`): Foundry installs no plugin for Antigravity (so text-to-cad, and CAD goals, are not available on it), keeps no MCP allowlist for its sessions and does not switch servers off for them.
- Tokens, not dollars: goals on Antigravity keep time, attempt and concurrency limits and never a USD budget. Usage shows tokens per session and the account's quota from `agy -p /usage`, which runs no model: one weekly limit per group of models, with what is left and when it resets. What agy reports when a group runs out has not been seen yet, so such a session fails and is retried like any other instead of pausing Antigravity: watch the quota card.
- Skill telemetry and the external session history do not apply to Antigravity.

## What was checked on a real account

Against agy 1.4.4 on a signed-in account (2026-10-22):

- The workspace hooks run in print mode once the file is spelled the way the CLI wants: session events take their handlers as they are, tool events under a matcher. One entry spelled the other way makes agy drop the whole file, so Foundry writes exactly these two shapes.
- A structured answer arrives through agy's `finish` tool into the result's `structured_output`.
- The guard refuses a worker's `git push` while ordinary commands run, and refuses a read-only role's file writes.
- A resumed conversation keeps its context; its canary comes from the `PreInvocation` hook.
- `agy -p /usage --output-format json` answers for the signed-in account. It carries the weekly quota, not the account's name, so Accounts shows the account as signed in without one.
- `agy models` lists the account's models; **Sync models** reads them.

- A whole goal runs end to end: the regression set's `fix-failing-test` case (Clarify and its planner, an engine-approved Brief, one worker attempt, the task and goal reviews) passed on its first attempt in 13.5 minutes. Its docs step ran out of the tool-call allowance (one call per turn at the time) just before it wrote; a turn now allows three. That docs session also read Foundry's own files and database while looking for context: sessions of every coding agent can read outside their workspace, and the guard refuses only the boundary's actions. Run it again with `bun scripts/regress.ts --provider agy --only fix-failing-test`; it uses your Antigravity quota, not dollars.

See the [first-goal guide](../guide/your-first-goal.md), the [model settings guide](../guide/settings.md#models--limits) and the [Codex guide](codex.md) for the second agent.
