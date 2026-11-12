# ADR-0090: An account's own usage windows, read as its coding agent reports them and shown per account

**Status:** accepted · 2026-11-12 · builds on [ADR-0065](0065-several-accounts-per-coding-agent.md) and [ADR-0088](0088-the-plan-an-account-is-on-is-named-as-its-coding-agent-names-it.md)

## Context

A person on a Claude subscription watches three figures: the 5-hour session window, the week over all models, and
the week of the top model, each a percentage with a reset time — what Claude's menu-bar app and `/usage` in Claude
Code show. Foundry showed none of them for Claude. Its Usage page had only the status a session's `rate_limit_event`
carried (within limit, nearing limit, limit reached) and Foundry's own spend; the note under it said the subscription
exposed no usage API. Codex and Antigravity had real percentages already, through `account/rateLimits/read` on the
Codex app-server and `agy -p /usage`. With several accounts per coding agent (ADR-0065), the person wants to see
each account's windows side by side before deciding which one to work on.

The facts behind the Claude figures, verified on 2026-11-11 (Claude Code 2.1.312):

- Claude Code reads them from `GET https://api.anthropic.com/api/oauth/usage` with the sign-in's OAuth bearer and the
  `anthropic-beta: oauth-2025-04-20` header. The answer carries `five_hour` (null when no session window is open),
  `seven_day`, a `limits[]` list (`weekly_all`, `weekly_scoped` per model with the model's display name, `spend`),
  `extra_usage`, and dozens of experiment fields that come and go between releases. Anthropic documents none of it.
- The token lives where Claude Code keeps it: on macOS the Keychain item `Claude Code-credentials`, or `Claude
  Code-credentials-<first 8 hex of sha256(dir)>` when `CLAUDE_CONFIG_DIR` names the dir (an added account's home);
  elsewhere `.credentials.json` in the config dir. It lasts about eight hours, and only Claude Code refreshes it:
  an account that has not run for a while holds a stale one. `claude -p "/usage" --output-format json` answers
  locally (no model turn, no cost) and refreshes the token on the way, but its answer is prose.
- Until now Foundry never read a token: every status came from the CLIs.

## Decision

- **Each account's own usage is shown per account, as bars with the percent used**, on every row of the Accounts
  page and on the Usage page's Accounts card (which Claude Code shows even with one account), through one component
  for the three coding agents. Claude's rows show **Session** (5-hour; drawn at 0% with *No active session* when the
  report has none, so the layout holds and the figure says something), **All models** (weekly), one row per model
  Claude limits on its own, and **Extra usage** only while it is turned on. Codex's rows show the windows its quota
  names, by length; Antigravity's one account shows its model groups. One rule colours every bar: amber from 50%
  used, red from 85%; Claude's own `severity` field is ignored, so the same colour means the same thing everywhere.
  The current account's row expands into cards with the reset time; the others stay bars. The Usage page's big
  Claude cards keep the status signal; the percentages live on the Accounts card. The top bar's Usage pill keeps
  its look and only says the current Claude account's figures in its tooltip. `foundry usage` prints the same
  windows, one block per account when there are several.
- **Claude's figures come from Claude's own usage report, read with the account's stored token, and Claude Code
  alone renews the token.** The reader takes the token from where Claude Code keeps it (the Keychain through the
  `security` tool, which Claude Code wrote the item with, so no prompt; else the credentials file; a token in the
  environment first, as for Claude Code) and never writes it, logs it or sends it anywhere but that one endpoint.
  When the token has expired, or the service refuses it, the reader runs Claude Code's own `/usage` once with that
  account's config dir, in an empty folder of its own (Claude Code reads the folder it starts in as a project), and
  reads again; an expired token is never sent. It never implements the refresh itself (refresh tokens rotate, and
  racing the CLI could sign the account out). A run that leaves the token as it was means the sign-in needs the
  person: the row says so, and no new run is made for a quarter of an hour, so a lapsed account costs one Claude Code
  run in that time rather than one per poll. Only `five_hour`, `seven_day`, `limits[]` and `extra_usage` are read; the
  experiment fields are left alone.
- **The report is read when asked and kept a minute, never polled by the engine.** The Accounts page reads every
  account and sign-in when it opens and on **Refresh status** (`/api/accounts?force=1`); every minute while it is
  open it reads the usage alone (`/api/accounts/usage`), not the sign-ins; any other caller of `/api/accounts` (the
  New goal form) gets the last reading at once. The Usage page's Accounts card asks for every account
  (`/api/usage?accounts=1`); the top bar's poll reads the current account alone. Each reading is kept in memory for a
  minute (five when the sign-in cannot be read, a quarter of one after a failure), so an account is asked at most
  once a minute whatever asks. Nothing is stored: no table, no event.
- **The figures inform; they never switch accounts early.** Auto switch keeps ADR-0065's rule (only after a real
  rejection, the next account in list order). The one thing they decide is how long a pause lasts: when a session's
  limit comes without a reset time, the account's own report says when its used-up window resets, as Codex's quota
  already did.
- **What cannot be read is a sentence, never an empty bar.** A 4xx, a changed shape or an unreachable service shows
  *Usage unavailable* with the reason on that account's row, goes to the server log, and touches nothing else. No
  beta flag: the feature only displays. A test run reads no sign-in at all (`claudeCredentials` in the config).

## Consequences

- A Claude account's standing is visible without opening Claude Code, per account, and the three coding agents
  read alike.
- Foundry now reads a credential for the first time, read-only and in memory. The reading goes to Anthropic's own
  usage service and nowhere else; the ADR and the guide say so.
- The endpoint is undocumented: when Anthropic changes it, the rows say the usage is unavailable until a release
  follows; everything else (sessions, pauses, switching) is untouched, as before this decision.
- Reading an added account's token (the Keychain item keyed to its home) is **untested on a real second account**:
  the author holds one Claude subscription. The formula was read from Claude Code's own code and the native path
  was verified live; a wrong item name falls back to the credentials file, then to *Usage unavailable*.
- Follow-ups kept out of this decision: choosing the account with most headroom at a switch; a top-bar indicator;
  threshold notifications; Claude's weekly breakdown by surface and Codex's reset credits on the rows.

## Alternatives considered

- **Only `claude -p "/usage"` and parsing its prose.** Rejected: the words change between releases, it takes
  seconds per account, and it omits the session row when no window is open. It stays as the token refresher.
- **Reading the token and refreshing it ourselves.** Rejected: that is Claude Code's job, the refresh token
  rotates, and a race could sign the account out.
- **Percentages on the Usage page's big Claude cards too.** The person chose not to: the Accounts card and the
  Accounts page are where accounts live.
- **Using the figures to pick the next account or to switch before a rejection.** Rejected: ADR-0065 decided
  "never early" on the providers' terms; headroom-based order is a follow-up.
- **A `beta.usage` flag.** Not needed for a read-only display with graceful degradation.
