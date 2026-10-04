# Codex integration validation

This record accompanies PR #52 before merge. It describes evidence for the shared Claude/Codex implementation, not a guarantee that every account, native CLI version or container host behaves identically. Current setup and capability limits are in [the operator guide](../operate/codex.md).

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
- Native smoke checks exercised ChatGPT account/quota reads and structured new/resumed sessions with host CLI `0.158.0-alpha.2`. Native plugin list/install/refresh/remove checks passed in an isolated local fixture marketplace on the host and Docker-pinned `0.160.0` CLI. A metadata-only account check confirmed a weekly-only account shape (two 10,080-minute groups, no short window) without capturing identity or usage percentages. Populated external history uses protocol fixtures; the native history smoke covered an isolated empty home. The Docker build pins the latter version; this does not imply every future CLI protocol is compatible.
- Browser checks use temporary repositories and fixture identities/quota. Guide screenshots show examples, not a measurement of a personal account. The UI follow-up checks Setup, Settings, Extensions, Usage and New goal with the shared backend selector, native keyboard navigation and padded select arrows in light/dark themes and at narrow widths.
- The UI follow-up also adds provider-specific health pause data and verifies notification names/links against mixed-provider and legacy events. Retry times are not described as guaranteed account resets.

### Timing observations

Earlier full runs observed an MCP hung-process timeout and a continuation wait timeout; isolated reruns passed. Another failure exposed a plugin shutdown test that assumed a native child would start within 200ms. A controlled 300ms startup reproduced that failure. The test now waits for a bounded readiness signal before exercising shutdown, with a longer fixture command timeout so it cannot accidentally test timeout cleanup instead. Its focused suite passed three consecutive runs (36 tests, 141 assertions), followed by the successful full suite above. The unrelated MCP and continuation timeouts were not reproduced or assigned an unproven root cause; they remain observations to watch on other hosts.

## Live integrations still requiring deployment validation

A full authenticated goal from start to finish in the final Docker image has not been exercised with a real ChatGPT account. External MCP OAuth also depends on the service, account policy and callback environment and has not been fully live-tested. Validate those paths on the intended deployment before relying on unattended production work. A native plugin fixture check does not cover either path.

Native Codex child-agent creation within Foundry sessions, USD inference cost/caps and Skill-tool invocation telemetry remain unavailable by design. Native marketplace setup, plugin updates and enable/disable controls remain in the CLI. These are explicit adapter limits, not covered features awaiting a green test.

## Upgrade and rollback

Use the [backup procedure](../operate/updates-and-backup.md) before upgrading real data. Keep the launch profile and configured state directory consistent. Both providers can share a current instance, but an older binary must not open mixed-provider data. Rollback requires its matching pre-upgrade state backup and application version; preserving only a container image is insufficient.
