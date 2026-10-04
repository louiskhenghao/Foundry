# Run Foundry with Codex

Foundry can drive either Claude Code or Codex CLI. Both use the same goal, interview, Brief, worktree, acceptance-check, review and delivery engine. The launch profile selects defaults and the data directory. Each new goal can select either backend in the same instance; all of its sessions keep that backend.

## Shared engine, independent native accounts

| Shared within one Foundry instance | Scoped to each backend |
| --- | --- |
| Goals, Briefs, worktrees, checks, reviews, delivery and event history | Native CLI process, session IDs and login home |
| Global concurrency budget and notifications | Models, presets, model discovery and fallback order |
| One Settings page and the same Agent backend selector | User skills, plugins, MCP configuration and allowlist |
| One Usage page and Agents monitor | Account quota and pause/retry state |

Signing into Claude does not sign into Codex. Setup/Accounts can keep both connected; changing a native login changes the account used by that CLI home outside Foundry too. Existing goals keep their backend. Switching **Agent backend** in a page changes the page’s scope; New goal uses it to choose the backend for the new goal.

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

Settings → **Models & limits** → **Agent backend → Codex** provides independent presets and model choices. Pick defaults for Code, Docs & research and Media, then edit the model and reasoning effort for each role, including Housekeeping. Built-in Max, Production, Balanced and Economy presets use the default model with different reasoning profiles; the names do not imply price or entitlement. Custom presets can be duplicated, edited, reset or deleted. Claude presets and aliases remain separate.

**Default Codex model** supplies the base model for preset entries set to `codex-default`. Choose a concrete ID to pin it, or retain `codex-default` to follow the native configuration. New goals capture their role tables and ordered fallback chain. Explicit all-role model overrides are stored separately and prefilled for follow-ups; distinct preset role assignments are not collapsed. A goal can choose another preset or explicitly override every role's model; its goal-wide effort overrides role efforts. A null goal effort uses the role preset, and a null role effort delegates to Codex. Native effort names are passed unchanged as `model_reasoning_effort`; legacy goals created before role presets retain the old `max` → `xhigh` mapping.

Without an explicit preset, the goal captures the configured default table for every nature. Auto classification can therefore choose the captured Docs or Media default without reading later Settings changes. An explicit preset captures that preset's complete tables and remains selected across classification.

**Sync Codex models** reads the local app-server catalog without inference. Discovered models and advertised effort levels are capabilities, not account-access guarantees. **Test** runs one short session using the chosen model and effort, consumes account quota. Custom IDs remain available for models absent from the catalog. Fallback runs only for model-unavailability failures before productive work; authentication, quota and invalid effort errors remain visible and do not silently switch models.

| Variable | Purpose |
| --- | --- |
| `FOUNDRY_PROVIDER=codex` | Select Codex at startup |
| `FOUNDRY_DATA_DIR` | Override the backend's default data directory |
| `FOUNDRY_CODEX_BIN` | Codex executable; defaults to `codex` on PATH |
| `FOUNDRY_CODEX_HOME` | Configuration/login home; falls back to `CODEX_HOME`, then `~/.codex` |
| `FOUNDRY_CODEX_MODEL` | Base model for default preset entries; defaults to `codex-default` |

Saved settings override the corresponding environment defaults. Configured binary and home changes require restarting Foundry. When no binary override is configured, Accounts re-resolves the executable on PATH for status, login and logout; installing or removing the CLI in an existing PATH directory invalidates the cached account result. Changing the process PATH itself still requires restarting with that environment. Model and preset changes apply to new Codex goals; existing goals retain their captured tables and fallback order after edits or deletion. A captured `codex-default` still follows the native Codex configuration. The complete keys are documented in [the configuration reference](configuration.md), including `models.codexPresets`, `models.codexPresetCode`, `models.codexPresetDocs`, `models.codexPresetMedia` and `models.codexFallbacks`.

## Permissions, skills and accounting

- Readers and reviewers use the read-only sandbox; workers use workspace-write. Workers can access the network for dependency installation and tests. Foundry's own checks and delivery still run on the host.
- Foundry supplies a session canary and a tool hook that checks the existing push/PR/deploy/publish boundary, the MCP allowlist and read-only roles. The runner waits for the canary and fails if it never appears. `--dangerously-bypass-hook-trust` is needed for these generated per-session hooks; other enabled user/project/plugin hooks also run under that invocation, so use reviewed hook sources. OS sandboxing remains enabled. Like the existing Claude boundary hook, this is a command guard, not a complete security boundary for arbitrary repository code.
- Codex native configuration, project `AGENTS.md` and installed skills remain available. Foundry lists user skills from the Codex home and shared `~/.agents/skills`, plus `.agents/skills` in a selected project. Shared skill directories cannot be uninstalled through Foundry. Setup and Extensions select their backend independently of the launch profile. Codex autoskills uses `.agents/skills`, excludes new installed skill contents from git and copies them into task worktrees. Extensions → Codex → Plugins lists installed and available native packages, installs them and removes user installations using the native CLI. Extensions → Codex → MCP servers manages native stdio and streamable HTTP servers, OAuth, connection checks and per-server permissions. Claude connectors and legacy SSE are not translated. Codex permissions live in `workflow.codexMcpAllowed` and never inherit the Claude allow list.
- Foundry runs a separate read-only Codex Planner session using the selected Planner model and effort. The Clarifier reviews its task proposal before producing the Brief. This is Foundry-managed orchestration; native Codex multi-agent delegation remains disabled. Foundry does not pass Claude's `--agents` definitions or rely on Claude's Skill tool.
- Codex JSONL reports token usage but no USD cost. Foundry reads ChatGPT account identity and quota separately through the native app-server. Usage shows all returned quota buckets, known windows and reported reset times beside local activity. Refresh reads account metadata without inference; ordinary polling caches it for 60 seconds. Missing fields stay unknown and only the explicit ordinary-usage allowance reports availability. A percentage or past reset time never proves recovery. Foundry marks dollar cost as unavailable. **USD caps cannot be enforced for Codex.** Use duration, concurrency, attempts and tool-call limits. The existing turn-cap setting bounds tool calls for Codex; it is not a model-turn count. CLI/API legacy numeric cost fields remain zero when cost is unreported.
- Structured output, live tool events, transcript reopening, session resume, cancellation, wall-clock timeout and idle timeout use the native Codex CLI protocol. On POSIX, cancellation and shutdown signal the owned process group and wait for forced cleanup of tool/MCP descendants. MCP manager shutdown also cancels queued changes and awaits active native processes; model discovery cleans up its sidecars. Foundry MCP denials retain tool names for provider-specific Inbox recovery, without storing arguments.

## Skill catalog compatibility

The catalog is selected before status, installation, updates and workflow hints. `providers` restricts a recipe to its supported backend(s); `providerSources` supplies a complete native source recipe when the same skill supports both. Omitted fields preserve the shared behavior. Claude plugin recipes remain excluded from the Codex skill catalog. Explicit git paths are authoritative: a missing path fails before replacing any existing skill, rather than falling back to another platform’s same-named directory.

The [compatibility table](../guide/settings.md#skill-compatibility) describes user-visible choices. Anthropic’s portable frontend-design and Python Playwright guidance remain available. Codex gets OpenAI’s skill-creator, `graphify install --platform codex`, and Impeccable’s `.agents/skills/impeccable` source. The Claude-only gstack recipe stays outside Codex recommendations; upstream’s experimental Codex setup is a separate integration and its outside-review workflow needs authenticated Claude CLI. This is not a claim that every gstack command is incompatible.

The Matt Pocock bundle contains eight current skills. Upstream removed resolving-merge-conflicts; the built-in Merger role retains conflict-resolution instructions without that external dependency. Existing personal/shared copies are not automatically deleted or rewritten. Update managed native variants or explicitly replace an old skill-creator copy in Extensions; shared-directory copies must be managed at their source. A found skill is not proof that all optional executables, image tools, credentials or child-agent capabilities are available.

## Docker

Build this revision locally; the already-published image may not contain Codex support yet:

```sh
docker build -t foundry-codex .
docker run --rm --init -it -v foundry-codex-home:/home/node/.codex foundry-codex codex login --device-auth
docker run --rm --init -p 127.0.0.1:4111:4111 \
  -e FOUNDRY_PROVIDER=codex \
  -v foundry-codex-home:/home/node/.codex \
  -v foundry-codex-data:/app/data-codex \
  -v "$HOME/code:/repos" foundry-codex
```

For Compose, set its `image` to the locally built tag and run with `FOUNDRY_PROVIDER=codex`. The compose file persists both backends' homes and data separately. Container hosts must support Codex's sandbox; a sandbox initialization failure is reported rather than retried with unrestricted access.

For upgrades and rollback, use [the backup guide](updates-and-backup.md). [The validation record](../develop/codex-validation.md) distinguishes automated and native checks from remaining live-integration checks.

Protocol references: [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex hooks](https://learn.chatgpt.com/docs/hooks).

## Product capabilities

See the bilingual [first-goal guide](../guide/your-first-goal.md), [model settings guide](../guide/settings.md#codex-presets-and-models) and [accounting guide](../guide/costs-and-usage.md). Account, model, Setup, Skills and MCP APIs accept `?provider=claude|codex`; omitted provider queries use the launch default. `/api/accounts` reports both account states and adapter capabilities. `POST /api/goals` accepts `provider`, `modelPreset`, optional `codexModel` for an explicit all-role override, and optional `effort`. Usage is filtered with the same provider query. Old goals receive an append-only provider assignment event before work starts. Do not run an older binary against a directory containing mixed-provider goals.

Agents includes recent external Codex conversations through bounded, cached native history requests without resuming or changing them. Foundry-owned sessions are deduplicated. External Codex sessions and child sessions have **unknown** process status because history does not establish liveness. Only Foundry-owned sessions can be stopped.

Remaining adapter limits are explicit: native Codex subagent creation inside Foundry sessions, USD accounting and skill-invocation telemetry are unavailable. Native marketplace configuration, plugin updates and enable/disable controls remain in the Codex CLI. Quota fields depend on the installed native CLI and signed-in account; the adapter does not invent missing limits. Role presets and the separate Foundry Planner do not imply those native capabilities have been added.


## CLI provider selection and accounts

`foundry doctor --provider codex` and every `foundry skills ... --provider codex` command use the selected backend, even in a Claude-default instance. Without a running server, they use the selected native home and the same provider-specific cache directories as the engine. Omitted `--provider` follows the running instance, or local settings when offline.

`foundry auth login|logout --provider codex` delegates to the running server, including when `FOUNDRY_URL` points to another host. Web and CLI requests reject account changes when Foundry reports active work. An explicitly configured but unreachable `FOUNDRY_URL` fails instead of changing the local account. Without an explicit URL or reachable local server, authentication uses the configured local native home. Codex login uses ChatGPT device authorization only. Claude code-based login can be completed in that server's Accounts page. Ctrl-C cancels the CLI's pending server login. Concurrent status polls coalesce, and an account change invalidates pending results so a late old poll cannot restore the previous identity.

`foundry usage --provider codex` prints only returned ChatGPT quota windows, labelled by their actual duration rather than primary/secondary position. Weekly-only, short-only, dual-window and custom-duration accounts are supported without a plan-name lookup. Missing windows remain absent, unknown duration remains unknown, and an empty named-bucket map falls back to the native legacy snapshot. The web header follows the same windows; multiple weekly groups are identified as weekly. Local activity uses a clearly labelled last-seven-days reporting period without quota/reset status. Legacy JSON `fiveHour`/`sevenDay` fields remain local activity aggregates for compatibility, not account entitlements. Unknown allowance and missing window fields remain unknown; reset timestamps are reported values, not a recovery guarantee.

## Native plugins

Extensions → Codex → Plugins uses `codex plugin list --json --available`, `plugin add <name@marketplace> --json` and `plugin remove <name@marketplace> --json`. The native CLI owns configuration, package caches and marketplace policy. Foundry accepts exact listed identifiers, serializes mutations, verifies the resulting native state and exposes operation progress without raw CLI output or private paths. Polling is cached for 30 seconds; explicit refresh and account/plugin changes invalidate it. Unsupported protocols produce an unavailable state instead of a fabricated empty inventory.

Only packages marked `AVAILABLE` expose install/remove controls. Changes are rejected while Foundry reports active work and affect the same Codex home used by the local CLI. Marketplace setup, plugin updates and enable/disable controls remain native CLI operations. Plugins may contain skills, MCP tools and hooks; installation does not grant Foundry's MCP allow list or authorize a connected service. Foundry lists packages separately from loose skills. Package structure follows the [official plugin format](https://developers.openai.com/plugins/build/plugins).
