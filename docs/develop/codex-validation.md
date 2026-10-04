# Codex integration validation

This record retains the PR #52 baseline and records the post-merge account-discovery, skill-catalog and shared-interface follow-ups. It describes evidence for the shared Claude/Codex implementation, not a guarantee that every account, native CLI version or container host behaves identically. Current setup and capability limits are in [the operator guide](../operate/codex.md).

## Repeatable checks

Run these from the repository root:

```sh
bun test packages ./apps/cli/src ./apps/web/tests
bun run typecheck
bun run web:build
bun scripts/gen-docs.ts
git diff --exit-code -- docs/operate/configuration.md docs/operate/cli.md
bun scripts/verify-codex-plugins.ts /path/to/codex
```

The full test command includes package, CLI and web regressions; plain `bun test` only runs the package test root. The guide tests check bilingual section/image parity, local links and Help anchors. There are no configured PR CI checks for this branch, so a clean GitHub merge status does not substitute for these local checks.

## Coverage and results

- The documentation/UI/pause follow-up passed **540 tests, 0 failures, 2,824 assertions across 87 files**, plus backend/frontend type checking and the production web build. The existing Vite large-chunk warning remains. Generated references are unchanged after regeneration; all 61 Markdown files checked have valid local file links.
- The pre-documentation/UI baseline (`4c88e2b`) passed 536 tests with 2,797 assertions, type checking and the production web build. Its focused Linux container run passed 54 tests with 283 assertions across eight files.
- Regression fixtures cover immutable goal providers, replay/migration, independent native accounts and login races, shared concurrency, provider-specific quota pauses, weekly-only/custom/unknown quota windows, captured presets and explicit follow-up overrides, model discovery/fallback, MCP permissions and recovery, native plugins, external history, structured output, resume and owned process cleanup.
- Native smoke checks exercised ChatGPT account/quota reads and structured new/resumed sessions with host CLI `0.158.0-alpha.2`. Native plugin list/install/refresh/remove checks passed in an isolated local fixture marketplace on the host and Docker-pinned `0.160.0` CLI. A metadata-only account check confirmed a weekly-only account shape (two 10,080-minute groups, no short window) without capturing identity or usage percentages. At this baseline, populated external history used protocol fixtures and the native history smoke covered an isolated empty home; see the terminal-handshake follow-up below for the later populated native listing check. The Docker build pins the latter version; this does not imply every future CLI protocol is compatible.
- Browser checks use temporary repositories and fixture identities/quota. Guide screenshots show examples, not a measurement of a personal account. The UI follow-up checks Setup, Settings, Extensions, Usage and New goal with the shared backend selector, native keyboard navigation and padded select arrows in light/dark themes and at narrow widths.
- The UI follow-up also adds provider-specific health pause data and verifies notification names/links against mixed-provider and legacy events. Retry times are not described as guaranteed account resets.

### Account discovery and skill compatibility follow-up (2026-10-05)

- **543 tests passed, 0 failed, 2,841 assertions across 89 files**, with backend/frontend type checking and a production web build. Generated CLI/settings references remain unchanged. The initial sandboxed run could not bind local test servers (17 failures); rerunning the same suite with local networking permitted produced the passing result. The Vite large-chunk warning remains.
- The local source-run symptom was reproduced read-only: Setup found an authenticated CLI while Accounts returned installed=true with “codex not installed”, including after force refresh. Two regression fixtures start an actual Engine/API before installing a fake CLI on an isolated PATH, then check Setup, Accounts, forced refresh, sign-in, sign-out and removal for each backend. They failed before the fix and pass after it. No personal account credentials were changed; the running source instance must be updated/restarted to use this code.
- Provider-catalog regressions exercise actual git fixture installations, bundle filtering, rejected direct installs, role hints and native manual commands. A missing explicit native path fails without overwriting an existing skill; path-less discovery remains supported.
- **24 real git skill installations** succeeded in disposable native homes: eight Matt Pocock skills plus frontend-design, webapp-testing, Impeccable and the appropriate skill-creator for each backend. Checks verified SKILL.md and the exact installed source marker path. No downloaded skill scripts were executed; this validates installation and dependencies documented by inspection, not every skill’s runtime workflow.
- Upstream snapshots: `mattpocock/skills` at `24fe0ef7737efae15c87225755e9f6f5965e4888`, `anthropics/skills` at `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, `openai/skills` at `49f948faa9258a0c61caceaf225e179651397431`; Impeccable uses the native `.claude/skills/impeccable` and `.agents/skills/impeccable` directories. [Upstream removal](https://github.com/mattpocock/skills/commit/daa01d8aa68ad5c61b68970ec2018d0ce9567be6) explains the removed merge skill. Graphify’s current upstream CLI advertises `--platform codex`; its system-level installer was not run on the personal machine.
- Browser checks confirmed Setup’s eight-skill bundle and built-in Merger description, the Codex Graphify command and OpenAI skill-creator catalog entry. The refreshed Setup screenshot uses demonstration account data. The compatibility audit and migration advice are in the [operator guide](../operate/codex.md#skill-catalog-compatibility) and bilingual [settings guide](../guide/settings.md#skill-compatibility).

### Shared interface and terminal history follow-up (2026-10-05)

- Final validation: **547 tests passed, 0 failed, 2,873 assertions across 89 files**. Backend/frontend type checking and production build passed; generated references are unchanged. An earlier run started before the new Agents screenshot existed and observed a delivery-test timeout with subsequent assertion failures. After capturing the screenshot, the delivery module passed 23 tests independently and the complete suite passed without changing delivery code. No unproven delivery root cause is assigned. The existing Vite large-chunk warning remains.

- Fixed a native handshake mismatch: Codex CLI 0.160.0 reports `Codex Desktop/0.160.0` in the desktop environment but `foundry_session_monitor/0.160.0` from an ordinary terminal. Recognize the exact caller name as well as official CLI/desktop names; retain the minimum-version guard before database-only history reads. The new regression failed before the fix and passes after it. Model discovery uses the same parser for its own caller name.
- A native read-only smoke with the desktop-originator override removed returned **30 recent Codex sessions, no warning**. Only counts, provider and unknown-process-state summaries were printed. No conversations were resumed, inference run or account credentials changed. Populated log pagination remains covered by protocol fixtures.
- The header is a stable **Usage** entry point for both backends. Native quota bars and accessible meter values express **remaining** allowance; absent or invalid values stay unknown. Regression cases cover both backend summaries, independent pauses, weekly-only accounts and clamped remaining percentages.
- Accounts keeps both cards in place during initial loading and refresh. With delayed fixture account responses, the Codex card measured the same y=208 and height=540 before, during and after the check. Agents has a shared all/Claude/Codex selector, inventory counts, combined search and keyboard-accessible session titles. Browser checks exercised keyboard engine selection, pointer selection, matching and empty searches, plus dark/light Accounts, Agents and Usage views; no browser console errors were recorded.
- README How it works and both guide languages use refreshed demonstration screenshots. The seeded demo now includes a Codex Brief and isolates the shared Codex skills directory before creating goals. Screenshots contain fixture identities/quota/sessions only.

### Timing observations

Earlier full runs observed an MCP hung-process timeout and a continuation wait timeout; isolated reruns passed. Another failure exposed a plugin shutdown test that assumed a native child would start within 200ms. A controlled 300ms startup reproduced that failure. The test now waits for a bounded readiness signal before exercising shutdown, with a longer fixture command timeout so it cannot accidentally test timeout cleanup instead. Its focused suite passed three consecutive runs (36 tests, 141 assertions), followed by the successful full suite above. The unrelated MCP and continuation timeouts were not reproduced or assigned an unproven root cause; they remain observations to watch on other hosts.

## Live integrations still requiring deployment validation

A full authenticated goal from start to finish in the final Docker image has not been exercised with a real ChatGPT account. External MCP OAuth also depends on the service, account policy and callback environment and has not been fully live-tested. Validate those paths on the intended deployment before relying on unattended production work. A native plugin fixture check does not cover either path.

Native Codex child-agent creation within Foundry sessions, USD inference cost/caps and Skill-tool invocation telemetry remain unavailable by design. Native marketplace setup, plugin updates and enable/disable controls remain in the CLI. These are explicit adapter limits, not covered features awaiting a green test.

## Upgrade and rollback

Use the [backup procedure](../operate/updates-and-backup.md) before upgrading real data. Keep the launch profile and configured state directory consistent. Both providers can share a current instance, but an older binary must not open mixed-provider data. Rollback requires its matching pre-upgrade state backup and application version; preserving only a container image is insufficient.
