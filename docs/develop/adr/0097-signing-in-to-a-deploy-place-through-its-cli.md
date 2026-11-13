# ADR-0097: Signing in to a deploy place through its own CLI, and installing the CLI, from Settings

**Status:** accepted · 2026-11-13 · amends ADR-0095

## Context

Every deploy place takes a credential pasted into Settings → Git & delivery (ADR-0041, ADR-0095, ADR-0096): a token
made on the place's website and copied over. Fly.io asks for more: its CLI must be on the computer too. People meet
both as chores, and the CLIs already know how to do them — `fly auth login` and `netlify login` open the browser,
wait for the approval, and come back signed in; Fly.io's installer is one line. The question was how far Foundry
should go in running them, and what it keeps afterwards.

What a CLI login leaves differs by place. Fly.io's session token "may expire quickly" (its own words on `fly auth
token`), but a signed-in CLI can make an organization token with an expiry of years. Netlify's login makes a
personal access token that lasts. Railway's and Vercel's logins leave OAuth tokens with refresh tokens and expiry
dates; Cloudflare's too; Expo, Render, Apple and Google have no CLI login that yields a token at all. So a sign-in
that ends in a token Foundry can keep exists for Fly.io and Netlify, and for the rest the honest help is the page
where the token is made.

## Decision

- **Sign in with the browser, for Fly.io and Netlify**, from the place's card in Settings. Foundry runs the CLI's own
  login — `fly auth login`; `netlify login --request` for a ticket, then `netlify login --check` until approved —
  with a **home folder of its own** under the data folder (`HOME`, `XDG_CONFIG_HOME`), so the CLI writes its session
  where Foundry knows and nothing lands in the person's dotfiles; the folder is removed when the sign-in ends,
  whatever way. The CLI opens the browser where it can; the page's address is also shown on the card and opened in a
  new tab by the page, so a Foundry in Docker or on a server works the same. Fly.io's approval page shows a code that
  finishes a login from another machine (`fly auth login --code`), and the card takes it.
- **What is kept is a token like a pasted one.** After Fly.io's approval Foundry makes an organization token
  (`fly tokens create org --name "Foundry (deploys)" --expiry 87600h`, the organization from Settings when set) and
  saves it as `delivery.flyToken`; after Netlify's it reads the personal access token the CLI stored
  (`users.<id>.auth.token` in its config.json, found under the sign-in's home) and saves it as `delivery.netlifyToken`.
  Nothing else changes: the deploys run exactly as with a pasted token, the engine keeps it, no session gets it, the
  card shows who signed in.
- **flyctl is installed on a click** with Fly.io's own installer (`curl -fsSL https://fly.io/install.sh | sh`, into
  `~/.fly`), the one thing here that touches the person's home, because it is what they would run by hand and the
  card says so before the click. `fly` is then found on the PATH or at `~/.fly/bin/fly`; the readiness item points at
  the card instead of the install page. The Docker image already carries flyctl.
- **The other places keep their links** to the page where the token is made, on the card, with what to do there.
  Railway and Vercel are not signed in through their CLIs on purpose: the tokens would expire under Foundry.

## Considered options

- **Running the deploys with the CLI's own session instead of a token.** Rejected: the session lives in the person's
  home, which a Foundry in Docker does not have, and expires; a token in Settings is one model for every place.
- **Netlify's OAuth ticket flow called directly** (the CLI's client id). Rejected: that would be Foundry posing as the
  Netlify CLI; running the CLI is what the person would do.
- **Downloading flyctl into Foundry's data folder** (pinned release, checksum). Considered and set aside by the owner:
  the official installer into `~/.fly` is what people already use and find later.
- **Signing in to Railway and Vercel too.** Rejected for now: their logins leave expiring OAuth tokens; refreshing them
  would be a second credential model.

## Consequences

- New module `engine/src/deploy/signin.ts`: the sign-in's state per place (waiting with the page, done with the account,
  failed in words), the home of its own, the token's making and reading, flyctl's presence and install. The engine
  gains `signIn`, `signInStatus`, `signInCancel`, `signInCode`, `flyctl`, `installFlyctl`, and the seams `signInPollMs`
  and `installFlyCommand`; `deployCli('fly')` resolves to the PATH or `~/.fly/bin/fly`.
- Routes: `GET/POST/DELETE /api/deploy/signin/:place`, `POST /api/deploy/signin/:place/code`, `GET /api/deploy/tools/fly`,
  `POST /api/deploy/tools/fly/install`.
- The Settings cards for Fly.io and Netlify carry the sign-in panel; Fly.io's the flyctl row. The user guide's
  Git & delivery section says what the sign-in does and leaves.
