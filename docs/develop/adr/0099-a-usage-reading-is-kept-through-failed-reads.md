# ADR-0099: A usage reading is kept through failed reads, and a wait the service asks for is honoured

**Status:** accepted · 2026-11-16 · amends ADR-0090

## Context

ADR-0090 reads each Claude account's own usage from Claude's usage service and shows it as bars on the Accounts page and
the Usage page's Accounts card. The reader kept one answer per account: the last one, whatever it was. A read that
failed replaced the reading of a minute ago with the failure, and the row went from three bars to one sentence,
**Usage unavailable · Claude's usage service asked to wait before it is read again.**

That sentence was on the page most of the time. The service answers 429 readily: the Accounts page reads every account
every minute, the top bar and the Usage page read the current one every thirty seconds, and a person with several
accounts has them all read. A failure was kept a quarter of a minute, so after a 429 the next poll asked again fifteen
seconds later and earned the next 429. The figures were there a minute ago and had hardly moved; nothing on the page
said so.

## Decision

The reader keeps the last reading that succeeded beside the answer it serves. When a read fails after a reading was
taken, the reading is served again with a `stale` mark: when the service was last asked (`triedAt`) and why that failed
(`message`). `checkedAt` keeps saying when the reading itself was taken. A failure with no reading behind it (the first
read, or after the sign-in changed) is still the failure itself, and a changed sign-in drops the kept reading with the
rest: it was another account's.

A wait the service asks for is honoured. A 429 is kept for what its `Retry-After` says, five minutes when it says
nothing (and an hour at most), so the page's polls are served from the kept reading until then; **Refresh status** asks
at once all the same, and that refusal starts the wait over. Any other failure is still tried again a quarter of a
minute later.

The page shows the kept reading as bars, as before, and says under them: **Usage as of 47m ago · the last reading that
could be taken; tried again 1m ago:** with the reason. The line is coloured by the age of the reading — plain under ten
minutes, amber under an hour, red after — on every account's row (a current reading says nothing on a row that is not
the current account's, as before), on the Usage page's Accounts card, and in `foundry usage`. The `account-meters`
module carries the mark and the age thresholds, so every surface says the same thing.

## Consequences

- A reading of an hour ago in red is a figure the person can act on; a blank sentence was not. The age colour is the
  honesty: a kept reading is never presented as current.
- Fewer requests reach the service while it refuses them, so the refusals themselves become rarer.
- A pause the engine computes from the usage (`claudeResumeAt`, ADR-0090) still works on a kept reading: a reset time
  that has passed is left out, as it always was.
- No reading survives a restart of Foundry; the first read after one is a real one. Persisting readings would need a
  table (ADR-0090 chose none) for a case that lasts seconds.
