# ADR-0041: Deploy — a finished goal's web app to Vercel, Netlify or Cloudflare Pages, on the person's click

**Status:** accepted · 2026-10-18 · amends ADR-0003

> Amended 2026-10-22: a Netlify or Vercel team slug the token cannot reach (Netlify answers it with a bare 404) fails with a reason that names the setting, and npm's own warnings and the CLIs' colours are left out of a failure's last lines.

## Context

Delivery ends with the goal's work in the repository's history; to see a web result online, the person still had to
deploy it themselves. The hosts people use for web pages (Vercel, Netlify, Cloudflare Pages) all have CLIs that can be
run headless with a token. Not every result belongs there: a worker or a backend deployed apart from its pages needs
infrastructure those hosts do not offer, and deploying half a system publishes a broken one.

ADR-0003 says remote actions are engine code under a policy the person chose, and that Foundry stores no token (GitHub
identity comes from `gh`'s own login). The hosts' CLIs have logins too, but they open a browser and keep their own
state in places the engine cannot see or drive reliably from a background process.

## Decision

- **Deploy** is a separate, explicit action on a finished goal (done or over-delivered), from the Delivery tab: a
  preview by default, production after a confirmation. It is never part of a delivery policy and never automatic.
- Only a web page or an all-in-one web app is deployed: a folder of pages, a site or single-page app a build turns into
  files, or a full-stack framework the host runs. A compose service built from the repository, a Procfile worker, a
  backend in its own folder (a server package, or a Go, Rust, Java, Ruby, Python or PHP service), a custom server beside
  the pages, or several web apps refuse the deploy with the reason in words. Cloudflare Pages gets files built here, so
  it takes no server-rendered app.
- The engine runs the host's CLI, pinned to a major version (`vercel@64`, `netlify-cli@27`, `wrangler@4`, through
  `npx`), in a checkout of the goal's commit of its own under the data folder, one per repository and named after the
  host project, so the host's link and the installed packages stay between deploys and every deploy goes to the same
  project. Nothing is pushed to the repository.
- The card shows the exact commands before anything runs; each command is recorded with its exit code and output, as
  delivery's are.
- **Tokens:** the hosts' tokens are kept in Settings (Git & delivery), as secret settings: masked in every view,
  sealed in a Transfer, given to the CLI in its environment only, never written on a command line or in a record (the
  output is redacted), and never handed to a coding session (unlike the Tools & keys, which sessions get). This departs
  from ADR-0003's "Foundry stores no token" for the hosts only, because their logins cannot be driven headless; the
  person chooses a token's scope (a team, Pages: Edit) and can revoke it at the host.
- The boundary guard that keeps a coding session from leaving the worktree now blocks every way of deploying to these
  hosts, however spelled: a bare `vercel` with only flags, versioned `npx` forms, `netlify-cli`, `wrangler pages
  deploy`, project creation, promotions and secrets. Deploying stays the person's act, run by the engine.

## Consequences

- A host's first deploy of a new project is its production deploy (Vercel's rule); the guide says so.
- A deploy needs network access and the host's build to succeed; a failure is recorded with the host's own words and
  notified like a delivery failure.
- An app that needs a database or other services online deploys, with a note that the host needs its own; Foundry does
  not provision them.
