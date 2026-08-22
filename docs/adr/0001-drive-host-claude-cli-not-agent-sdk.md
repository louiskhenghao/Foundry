# 0001 — Drive the host `claude` CLI rather than the Agent SDK

Date: 2026-08-21
Status: Accepted

## Context

ai-engine runs many Claude sessions (clarify, work, review, merge), some in parallel, on the user's own Mac. There are two programmatic ways to run Claude Code:

1. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which offers typed `query()` options, a `canUseTool` callback, in-process MCP servers and `maxBudgetUsd`.
2. The `claude` CLI in headless mode (`claude -p --output-format stream-json`).

The SDK's documentation requires an `ANTHROPIC_API_KEY` and states that Anthropic does not allow third-party developers to offer claude.ai login or subscription rate limits in products built on the SDK. Using it would mean per-token API billing, and the system would no longer be "calling the host's Claude".

We verified on this machine that `claude -p` runs with the host's existing subscription login (no API key in the environment) and returns `session_id`, `total_cost_usd`, per-model usage, `permission_denials`, `subagent_stats` and `rate_limit_event` messages — everything the orchestrator needs. We also verified that `--settings` inline JSON injects `PreToolUse` hooks in `-p` mode and that `--model` overrides the user's settings.

## Decision

All Claude invocations go through a `ClaudeRunner` interface whose only v1 implementation spawns the host `claude` CLI as a subprocess with `stream-json` output. The Agent SDK is not used.

Each Attempt is a fresh `-p` invocation with the prompt passed as an argument; stdin multi-turn (`--input-format stream-json`) is not used in v1.

## Consequences

- Sessions use the same identity, quota, skills, MCP servers and hooks as the user's interactive Claude Code. User-level hooks (e.g. gstack) also run inside every spawned session; this is mitigated with `--setting-sources` where needed.
- We parse the `stream-json` protocol ourselves. Unknown message types are passed through to the transcript file and ignored.
- Cost figures are client-side estimates and serve as a proxy for subscription usage; `rate_limit_event` is the authoritative signal for the five-hour window.
- Moving to a server deployment later means writing an `AgentSdkRunner` (API key) behind the same interface; the engine does not change.
