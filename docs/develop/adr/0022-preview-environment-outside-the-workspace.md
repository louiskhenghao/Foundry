# ADR-0022: Preview environment stays outside the goal's folder

**Status:** accepted · 2026-10-05

## Context

A goal's apps usually need values a project keeps out of git: database URLs, API keys, bot tokens. A goal's progress
folder (a worktree) therefore never has them, and previews of such apps fail. Two obvious fixes are both wrong:

- Copying the person's env files into the progress folder puts secrets where coding agents read and write files, and
  from there into model context and transcripts.
- Reading the person's checkout env files automatically and injecting them makes values the person never chose
  override the project's own tracked env files (process environment beats `.env` files in Next.js, Vite and dotenv),
  and points agent-written start scripts (migrations, seeds) at whatever database those files name, possibly a shared
  or production one.

## Decision

- The person enters variables for a repository on the Preview card. They are shared by the repository's goals and
  stored in `preview-env.json` in the data directory with owner-only permissions, each repository's set with a
  revision, so a save made from an outdated view is refused rather than losing another tab's changes.
- The checkout's untracked env files (`.env`, `.env.development`, `.env.local`, `.env.development.local`; root and app
  folders; tracked files are left to the worktree) are read only when the person presses **Import from your
  checkout**, which copies keys not set yet into the entered set.
- A preview process gets Foundry's own environment and session keys, then the entered variables, then Foundry's own
  variables (`PORT`, `FOUNDRY_APP_<KEY>_URL`, `HOST` in Docker), which win. Dependency installs do not get the entered
  variables (a `NODE_ENV=production` there would skip dev dependencies).
- Values are passed as process environment only; nothing is written into the progress folder. The API returns names,
  never values: the UI shows a saved value as "saved" and replaces it only when a new one is typed.
- Values of six or more characters are replaced with `••••` in the preview's output, its failure lines and the
  self-check's report, the texts that sessions and the event log see.
- Example files (`.env.example`, `.env.sample`, `.env.template`, `.env.local.example`) only inform: the card lists keys
  they mention that nothing provides, without an example value first.
- Foundry does not generate secrets. It fills in only what it owns: ports and app addresses.

## Consequences

- The preview runs the goal's code, so that code can read the values. Redaction protects the texts Foundry keeps, not
  what the code does with a value.
- Entered values take precedence over the project's env files, unlike a value in an untracked file of the same name.
- Values are taken literally: no `${VAR}` expansion.
- Coding sessions do not get these values; a test that needs a secret must get it another way.
