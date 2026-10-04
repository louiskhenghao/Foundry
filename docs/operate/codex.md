# Run Foundry with Codex

Foundry can drive either Claude Code or Codex CLI. Both use the same goal, interview, Brief, worktree, acceptance-check, review and delivery engine. The launch profile selects defaults and the data directory. Each new goal can select either backend in the same instance; all of its sessions keep that backend.

## From source

Install Bun and git, then install a recent Codex CLI with `SessionStart` and `PreToolUse` hooks (the Docker build pins 0.160.0):

```sh
npm install -g @openai/codex
codex login
bun install --frozen-lockfile
bun run web:build
bun run serve:codex
```

Open <http://127.0.0.1:4111>. Setup checks **Codex CLI** and **Codex login**; the account menu signs in using ChatGPT device authorization. Enter the printed device code on the linked OpenAI page. API-key login is not used for Codex inference.

`bun run dev:codex` starts the development watcher. The equivalent production command is `FOUNDRY_PROVIDER=codex bun run serve`.

The Codex launch profile defaults to `data-codex/`; the Claude launch profile uses `data/`. All goals in an instance share its selected directory. To choose another location, set `FOUNDRY_DATA_DIR`. Foundry records the backend owning each data directory and refuses to open it through the other backend, preventing incompatible session resumes. Both providers can now run within one instance. Existing separate data directories are not merged automatically. If you keep separate instances, use distinct `FOUNDRY_PORT` values and preview port ranges.

```sh
FOUNDRY_PROVIDER=codex FOUNDRY_PORT=4112 FOUNDRY_PREVIEW_PORT_FROM=4300 FOUNDRY_PREVIEW_PORT_TO=4399 bun run serve
FOUNDRY_PROVIDER=codex FOUNDRY_PORT=4112 bun run cli auth status
```

## Models and configuration

Settings → Models & limits provides a **Codex model** field. `codex-default` follows the default in your Codex configuration. Enter a concrete model ID to pin it. New Codex goals copy this selection to all roles, including housekeeping; Claude model presets and fallback aliases are not sent to Codex. Effort is passed as `model_reasoning_effort`; `max` maps to `xhigh`.

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_PROVIDER=codex` | Select Codex at startup |
| `FOUNDRY_DATA_DIR` | Override the backend's default data directory |
| `FOUNDRY_CODEX_BIN` | Codex executable; defaults to `codex` on PATH |
| `FOUNDRY_CODEX_HOME` | Configuration/login home; falls back to `CODEX_HOME`, then `~/.codex` |
| `FOUNDRY_CODEX_MODEL` | Default model; defaults to `codex-default` |

Saved settings override the corresponding environment defaults. Binary and home changes require restarting Foundry. The default model applies to new Codex goals. Each goal snapshots its selection; codex-default still follows the native Codex configuration.

## Permissions, skills and accounting

- Readers and reviewers use the read-only sandbox; workers use workspace-write. Workers can access the network for dependency installation and tests. Foundry's own checks and delivery still run on the host.
- Foundry supplies a session canary and a tool hook that checks the existing push/PR/deploy/publish boundary, the MCP allowlist and read-only roles. The runner waits for the canary and fails if it never appears. `--dangerously-bypass-hook-trust` is needed for these generated per-session hooks; other enabled user/project/plugin hooks also run under that invocation, so use reviewed hook sources. OS sandboxing remains enabled. Like the existing Claude boundary hook, this is a command guard, not a complete security boundary for arbitrary repository code.
- Codex native configuration, project `AGENTS.md` and installed skills remain available. Foundry lists user skills from the Codex home and shared `~/.agents/skills`, plus `.agents/skills` in a selected project. Shared skill directories cannot be uninstalled through Foundry. The Claude plugin manager and Claude-specific autoskills installer are not used; manage Codex plugins and MCP servers through Codex. Permit MCP servers with their `mcp__server` prefixes in Settings → Safety.
- Foundry runs the planner role within the Codex clarification session. It does not pass Claude's `--agents` definitions or rely on Claude's Skill tool.
- Codex JSONL reports token usage, but no USD cost or account quota. Foundry shows token activity and marks dollar cost as unavailable. **USD caps cannot be enforced for Codex.** Use duration, concurrency, attempts and tool-call limits. The existing turn-cap setting bounds tool calls for Codex; it is not a model-turn count. CLI/API legacy numeric cost fields remain zero when cost is unreported.
- Structured output, live tool events, transcript reopening, session resume, cancellation, wall-clock timeout and idle timeout use the native Codex CLI protocol.

## Docker

Build this revision locally; the already-published image may not contain Codex support yet:

```sh
docker build -t foundry-codex .
docker run --rm -it -v foundry-codex-home:/home/node/.codex foundry-codex codex login --device-auth
docker run --rm --init -p 127.0.0.1:4111:4111 \
  -e FOUNDRY_PROVIDER=codex \
  -v foundry-codex-home:/home/node/.codex \
  -v foundry-codex-data:/app/data-codex \
  -v "$HOME/code:/repos" foundry-codex
```

For Compose, set its `image` to the locally built tag and run with `FOUNDRY_PROVIDER=codex`. The compose file persists both backends' homes and data separately. Container hosts must support Codex's sandbox; a sandbox initialization failure is reported rather than retried with unrestricted access.

Protocol references: [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex hooks](https://learn.chatgpt.com/docs/hooks).

## Product capabilities

See the bilingual [first-goal guide](../guide/your-first-goal.md) and [accounting guide](../guide/costs-and-usage.md). Account APIs accept `?provider=claude|codex`; `/api/accounts` reports both account states and adapter capabilities. `POST /api/goals` accepts `provider` and optional `codexModel`. Usage is filtered with the same provider query. Old goals receive an append-only provider assignment event before work starts. Do not run an older binary against a directory containing mixed-provider goals.
