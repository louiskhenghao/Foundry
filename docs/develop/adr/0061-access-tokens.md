# ADR-0061: Access — a token per person, and who did what

**Status:** accepted · 2026-10-21 · builds on [ADR-0003](0003-engine-only-remote-actions-under-human-policy.md) and [ADR-0038](0038-chat-answers-from-telegram.md)

## Context

Foundry has had no login: it listens on loopback, refuses cross-site requests and unknown host names, and reaching
it from a phone means a tailnet (remote-access.md). That is right for one person on their own machine. It is the
first question anyone deploying the public repository asks, and it fails as soon as a machine serves two or three
people on one tailnet: everyone is everyone, a Brief approved is approved by nobody in particular, and a lost phone
means re-doing the tailnet. The Foundry machine holds the coding-agent logins, the repositories and a `gh` that can
push: whoever reaches port 4111 has all of it.

## Decision

- **A list of people, each with a token.** Settings → Access (and `foundry access`) adds a person and shows their
  token once; only its SHA-256 fingerprint is kept, in `access.json` beside the data — never in the event log, so never
  in a Transfer. **With no one on the list nothing changes:** no login, as today. Once anyone has a token, every `/api`
  request and the live feed must carry one — a bearer header (the CLI's `FOUNDRY_TOKEN`) or the cookie the sign-in
  page sets (HttpOnly, same-site, 90 days, Secure behind HTTPS). Two requests stay open: *am I signed in* and *sign
  in*; failed sign-ins are slowed to ten a minute.
- **Turning it on locks no one out.** The first token signs in the browser that made it. Revoking a token stops it
  at once on every device; revoking the last one turns Access off.
- **Who did what.** The person a request carries is recorded where a human acts: the goal they asked for (`goal.by`),
  the Brief they approved (`approvedBy`, from `brief.approved`), the Inbox item they answered (`answeredBy`, from
  `escalation.answered`). The goal page says *asked by Ada, Brief approved by Bob*; the Inbox says who answered. An
  answer from Telegram or Discord carries no name. Older events have no field and replay unchanged.
- **A light lock, not a perimeter.** Access is for people who already share a tailnet or a LAN; the checklist in
  remote-access.md still holds, and nothing here is a reason to face the internet. No roles: anyone signed in may add
  or revoke people, as anyone at the keyboard could before.

## Considered options

- **Passwords and accounts.** Rejected: a password store, resets and sessions for two or three trusted people is
  more surface than it saves; a token is handed over once and revoked once.
- **Tailscale identity headers** (who the tailnet says you are). Rejected for now: it ties the feature to one setup and
  to `tailscale serve`'s headers; a token works on a LAN, behind any proxy, and from the CLI. It remains the natural
  next step for a tailnet-only install.
- **Roles (owner, approver, viewer).** Rejected: the people a Foundry serves are the people trusted with its machine;
  recording who did what is what was missing, not stopping them.
- **Tokens in Settings** (the settings file, masked like API keys). Rejected: settings travel with a Transfer and are
  read back as a view; tokens belong to one machine and need no editing, only adding and revoking.

## Consequences

- `engine/src/access.ts` (`Access`, `Person`, `AccessError`), `Engine.access`; the `/api/*` token middleware,
  `/api/access/*` and `tokenOf` in `server/src/app.ts`, the `/ws` check in `server/src/index.ts`; `Goal.by`,
  `Goal.approvedBy`, `Escalation.answeredBy`; `by` on `brief.approved` and `escalation.answered`;
  `CreateGoalInput.by`, `Engine.approveBrief(…, by)`, `Engine.answerEscalation(…, by)`.
- The web app's requests go to `/login` on a 401 and come back afterwards; `apps/web/src/pages/LoginPage.tsx`,
  `apps/web/src/pages/settings/AccessCard.tsx`, Sign out under ⚙.
- `foundry access [list|add|revoke]`; every CLI request carries `FOUNDRY_TOKEN` when set.
- The docs no longer say "the UI has no login": it has none until people have tokens.
