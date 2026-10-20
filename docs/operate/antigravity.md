# Run Foundry with Antigravity

Foundry can drive Claude Code, Codex CLI or the Antigravity CLI (`agy`, Google's successor to the Gemini CLI). All three share the goal, interview, Brief, worktree, acceptance-check, review and delivery engine; the launch profile selects defaults and the data directory, and each new goal picks its coding agent, which all of its sessions keep.

## Shared engine, what Antigravity brings

| Shared within one Foundry instance | Scoped to Antigravity |
| --- | --- |
| Goals, Briefs, worktrees, checks, reviews, delivery and event history | The native CLI process, conversation ids and the account it signed in with |
| Global concurrency budget and notifications | One model and one reasoning effort for every role; `agy models` fills the list |
| One Settings page and the same Coding agent selector | The skills in a project's `.agents/skills` and the shared `~/.agents/skills`; plugins and MCP servers managed in agy itself |
| One Usage page and Agents monitor | Token counts (no USD cost, no account quota) |

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

Settings → **Models & limits** → **Coding agent → Antigravity** holds the **Antigravity model** every role of a new goal runs on (`agy-default` follows the model the CLI itself is set to; **Sync models** lists the slugs `agy models` knows) and the **Reasoning effort** (low, medium or high). A goal snapshots both at creation; `--agy-model` on the CLI or the New goal page pins another model for one goal. There are no presets and no fallback order: the CLI refuses an unknown model outright, and the session fails.

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_PROVIDER=agy` | Select Antigravity at startup |
| `FOUNDRY_DATA_DIR` | Override the backend's default data directory |
| `FOUNDRY_AGY_BIN` | Antigravity executable; defaults to `agy` on PATH |
| `FOUNDRY_AGY_MODEL` | The model of every role; defaults to `agy-default` |

Saved settings override the corresponding environment defaults; a changed binary needs a restart.

## Permissions, skills and accounting

- Every session runs with `--dangerously-skip-permissions` under Foundry's own guard: a `PreToolUse` hook in the workspace's `.agents/hooks.json`, added for the session and taken out after it (your own entries stay; the file is git-excluded). It keeps the boundary (no push, PR, deploy or publish from a session), denies the file tools to read-only roles, and counts tool calls against the goal's turn allowance. A `SessionStart` hook writes the session canary; a session whose canary never appears is stopped before it works.
- Read-only roles are enforced on the file tools only; a shell command can still write. Codex has an operating-system sandbox for this; Antigravity's `--sandbox` is undocumented in its effect and is not used.
- Antigravity reads the skills Foundry places in a project's `.agents/skills` (workflow suites, the Learnings notebook), as Codex does, and the shared `~/.agents/skills`. Plugins and MCP servers are managed in agy itself: Foundry keeps no MCP allowlist for Antigravity sessions and does not switch servers off for them.
- Tokens, not dollars: goals on Antigravity keep time, attempt and concurrency limits and never a USD budget. Usage shows tokens per session; no account quota is read.
- Autoskills, the `skills` CLI updates, skill telemetry and the external session history do not apply to Antigravity.

## What is not verified here

This integration follows the CLI's documentation; no Antigravity account ran it on the machine it was built on. The first real goal should confirm three things, each of which the session or Doctor reports when it is off: the workspace hooks run in print mode (else every session stops before work), structured output lands in the result's `structured_output`, and `agy -p /usage --output-format json` answers for a signed-in account.

See the [first-goal guide](../guide/your-first-goal.md), the [model settings guide](../guide/settings.md#models--limits) and the [Codex guide](codex.md) for the second agent.
