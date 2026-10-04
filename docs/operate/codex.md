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

Settings → **Models & limits** → **Codex** provides independent presets and model choices. Pick defaults for Code, Docs & research and Media, then edit the model and reasoning effort for each role, including Housekeeping. Built-in Max, Production, Balanced and Economy presets use the default model with different reasoning profiles; the names do not imply price or entitlement. Custom presets can be duplicated, edited, reset or deleted. Claude presets and aliases remain separate.

**Default Codex model** supplies the base model for preset entries set to `codex-default`. Choose a concrete ID to pin it, or retain `codex-default` to follow the native configuration. New goals capture their role tables and ordered fallback chain. A goal can choose another preset or explicitly override every role's model; its goal-wide effort overrides role efforts. A null goal effort uses the role preset, and a null role effort delegates to Codex. Native effort names are passed unchanged as `model_reasoning_effort`; legacy goals created before role presets retain the old `max` → `xhigh` mapping.

Without an explicit preset, the goal captures the configured default table for every nature. Auto classification can therefore choose the captured Docs or Media default without reading later Settings changes. An explicit preset captures that preset's complete tables and remains selected across classification.

**Sync Codex models** reads the local app-server catalog without inference. Discovered models and advertised effort levels are capabilities, not account-access guarantees. **Test** runs one short session using the chosen model and effort, consumes account quota. Custom IDs remain available for models absent from the catalog. Fallback runs only for model-unavailability failures before productive work; authentication, quota and invalid effort errors remain visible and do not silently switch models.

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_PROVIDER=codex` | Select Codex at startup |
| `FOUNDRY_DATA_DIR` | Override the backend's default data directory |
| `FOUNDRY_CODEX_BIN` | Codex executable; defaults to `codex` on PATH |
| `FOUNDRY_CODEX_HOME` | Configuration/login home; falls back to `CODEX_HOME`, then `~/.codex` |
| `FOUNDRY_CODEX_MODEL` | Base model for default preset entries; defaults to `codex-default` |

Saved settings override the corresponding environment defaults. Binary and home changes require restarting Foundry. Model and preset changes apply to new Codex goals; existing goals retain their captured tables and fallback order after edits or deletion. A captured `codex-default` still follows the native Codex configuration. The complete keys are documented in [the configuration reference](configuration.md), including `models.codexPresets`, `models.codexPresetCode`, `models.codexPresetDocs`, `models.codexPresetMedia` and `models.codexFallbacks`.

## Permissions, skills and accounting

- Readers and reviewers use the read-only sandbox; workers use workspace-write. Workers can access the network for dependency installation and tests. Foundry's own checks and delivery still run on the host.
- Foundry supplies a session canary and a tool hook that checks the existing push/PR/deploy/publish boundary, the MCP allowlist and read-only roles. The runner waits for the canary and fails if it never appears. `--dangerously-bypass-hook-trust` is needed for these generated per-session hooks; other enabled user/project/plugin hooks also run under that invocation, so use reviewed hook sources. OS sandboxing remains enabled. Like the existing Claude boundary hook, this is a command guard, not a complete security boundary for arbitrary repository code.
- Codex native configuration, project `AGENTS.md` and installed skills remain available. Foundry lists user skills from the Codex home and shared `~/.agents/skills`, plus `.agents/skills` in a selected project. Shared skill directories cannot be uninstalled through Foundry. The Claude plugin manager and Claude-specific autoskills installer are not used; manage Codex plugins and MCP servers through Codex. Permit MCP servers with their `mcp__server` prefixes in Settings → Safety.
- Foundry runs a separate read-only Codex Planner session using the selected Planner model and effort. The Clarifier reviews its task proposal before producing the Brief. This is Foundry-managed orchestration; native Codex multi-agent delegation remains disabled. Foundry does not pass Claude's `--agents` definitions or rely on Claude's Skill tool.
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

See the bilingual [first-goal guide](../guide/your-first-goal.md), [model settings guide](../guide/settings.md#codex-presets-and-models) and [accounting guide](../guide/costs-and-usage.md). Account and model APIs accept `?provider=claude|codex`; `/api/accounts` reports both account states and adapter capabilities. `POST /api/goals` accepts `provider`, `modelPreset`, optional `codexModel` for an explicit all-role override, and optional `effort`. Usage is filtered with the same provider query. Old goals receive an append-only provider assignment event before work starts. Do not run an older binary against a directory containing mixed-provider goals.

Remaining adapter limits are explicit: native Codex subagents, Foundry-managed Codex plugin/MCP installation, external Codex session import, USD accounting, exact account quota and Skill-tool telemetry are unavailable. Role presets and the separate Foundry Planner do not imply those native capabilities have been added.
