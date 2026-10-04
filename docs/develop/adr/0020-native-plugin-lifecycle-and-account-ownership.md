# ADR-0020: Native plugin lifecycle and server-owned account commands

**Status:** accepted · 2026-10-04 · amends ADR-0019

## Decision

Add a Codex-only Plugins tab for native inventory and user installation/removal. Delegate to the CLI's JSON plugin commands; do not reproduce its cache layout, write its configuration or reinterpret marketplace policy. Require an exact listed `name@marketplace` identifier and `AVAILABLE` policy, serialize mutations and verify their resulting native installation state. Other policies, updates, marketplace setup and enablement remain native responsibilities.

Separate package inventory from the loose-skills inventory. Share the configured native home with the local CLI and explain that new sessions see the changed components. Installation grants neither Foundry's MCP allow list nor a connected service's authorization. Reuse the operations log, bound subprocess duration/output, await process cleanup during shutdown and keep raw diagnostics and source paths private. Cache reads for 30 seconds, with refresh and mutation/account invalidation.

CLI Skills and Doctor use the requested provider both online and offline, including that provider's native home and engine cache directory. Online auth commands operate on the running server's account. Web and CLI login/logout and plugin changes reject requests when Foundry reports active work. An unreachable explicit `FOUNDRY_URL` never falls back to mutating a different local account. Without an explicit remote URL or reachable local server, the CLI retains offline native authentication. Codex login remains ChatGPT-only.

## Trade-offs

Using native commands preserves Codex's policy and install behavior, at the cost of requiring a compatible CLI. Unsupported or malformed inventory is unavailable, not an empty success. The page intentionally exposes only the supported install/remove lifecycle; it does not translate Claude plugins. Loose-skill updates do not update native packages. Installed disabled packages remain distinguishable from available packages.

Active-work checks observe this Foundry instance; another terminal or Foundry instance sharing the same native home can still change its account or plugins independently. Native installation and account flows do not provide a cross-process transaction with goal scheduling. Changes are intended for an idle instance, and credentials remain native-client owned.
