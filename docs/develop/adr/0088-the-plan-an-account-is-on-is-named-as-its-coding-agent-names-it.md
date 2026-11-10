# ADR-0088: The plan an account is on is named as its coding agent names it, read again whenever the sign-in is

**Status:** accepted · 2026-11-10 · amends the last point of [ADR-0085](0085-effort-levels-come-from-the-coding-agents-binary.md) · builds on [ADR-0065](0065-several-accounts-per-coding-agent.md)

## Context

The Accounts page, the Usage page's Accounts card and the doctor say which plan each sign-in is on. The word came
straight from the sign-in: Claude Code's `claude auth status --json` field `subscriptionType`, Codex's `planType` from
`account/read`, whatever Antigravity's `/usage` payload carried. ADR-0085 left it so.

Anthropic renamed the top Claude plan: the person is on **Ultra**, and Foundry kept saying **max**. The token's
`subscriptionType` still reads `max` (the plan's old key, which the API keeps); the plan's name lives in a different
place, Claude Code's own config file `.claude.json` (`oauthAccount.planDisplayName`, beside `organizationRateLimitTier`
such as `default_claude_max_20x`), which `auth status` does not print. The same will happen again, on any of the three
agents, whenever a maker renames or adds a plan.

An added account (ADR-0065) had a second staleness: its plan was written into its `account.added` event when it was
signed in and never read again, so an upgrade after that never showed.

## Decision

- **A plan is named for a person by one function, `planName(provider, { displayName, type })` in core.** The name the
  coding agent itself shows wins; else the subscription type's key is said as its maker names the plan (`max` → Max,
  `plus` → Plus); a key Foundry has never seen is said in title case (`ultra_plus` → Ultra Plus). Never a bare key, never
  nothing when the agent reports something, and a name already in words passes through unchanged.
- **Every sign-in status carries `plan` (the name) beside `subscriptionType` (the raw key).** Claude Code's name comes
  from the status itself when a release adds such a field, else from `.claude.json` in the config dir the status was
  read with (`~/.claude.json` for the default home, the account's own home for an added account), and only when that
  file names the same account as the status does, so a sign-in changed outside Foundry never lends its plan to another.
  Codex's comes from `planType`. Antigravity's from the fields its payload is likely to use once it reports a tier; it
  reports none today, and none is shown.
- **An added account's plan is what its sign-in last reported.** The pool overlays each added account with the plan of
  its last status read; the Accounts route reads every account's sign-in before it builds the views, so one load of the
  page is current. A plan stored by an older Foundry as the token's key (`max`) is given again through `planName` and
  shows as Max. No new event: the stored name is only what was known when the account was added, and a status read
  is the record of what it is now.

## Consequences

- A renamed plan shows under its new name without a Foundry release wherever the agent exposes the name; where it only
  exposes a new key, the key shows in title case until a release adds its word, which is cosmetic.
- Reading `.claude.json` is reading a file Claude Code owns and documents nowhere: the field can move. When it does,
  the plan falls back to the subscription type's word (Max), the behaviour before this decision, so nothing breaks.
- Until an added account's sign-in has been read since the engine started, the Usage page shows its stored plan; the
  Accounts page reads every sign-in on load, so it is always current there.

## Alternatives considered

- **A table of plan names by key, updated by release.** Rejected alone: it is what ADR-0085 escaped for effort levels,
  and the renamed plan's key did not change, so no table could have told Ultra from Max. It stays as the fallback.
- **Showing the rate-limit tier beside the plan (Max 20×).** Not taken: the tier's meaning under a renamed plan is the
  maker's, and the person asked for the plan's name.
- **An `account.updated` event when a status read differs from what was stored.** Rejected: a read would write, and
  the overlay gives the same answer without a new event type or projection.
