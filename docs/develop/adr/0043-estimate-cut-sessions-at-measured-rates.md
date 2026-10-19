# ADR-0043: A cut session's cost is estimated from its tokens at the rate its model was measured at

**Status:** accepted · 2026-10-19 · amends ADR-0037

## Context

ADR-0037 made a session cut before its result line *unmeasured*: its turns and tokens are counted, its dollars are
unknown, and every total leaves it out and says how many it left out (**+N unmeasured**, **unknown**). It refused a
price table: an estimate shown as a measurement is the same lie with more digits.

In use the unknown was common, not rare, and it said too little. The sessions that run into their time limit are the
long workers, the ones that cost most; a goal full of them showed **unknown** on most rows of a task's session list and
a total that was a fraction of the real one, with nothing to say whether the missing part was a dollar or fifty. The
meter's **+N unmeasured** label was also too long for a phone and pushed the meter's figures off its card.

A cut session's tokens are known (ADR-0037 counts them), and every session that did report records what tokens cost on
this instance: the same models, the same account, the same caching.

## Decision

- **A rate measured here, not a price list.** For each model, the rate is the reported dollars over the tokens of every
  ledger row that reported its cost (`cost_status` reported or null, `cost_usd > 0`), the tokens weighted as input-token
  equivalents: input 1, output 5, cache read 0.1, cache write 1.25, the ratios Anthropic prices its Claude models at. A
  model never measured under its own name takes its family's rate (fable, opus, sonnet, haiku), pooled over the
  family's models; a model with neither gets no estimate.
- **An estimate, said so.** A cut session's estimate is its weighted tokens times that rate. The goal detail carries the
  goal's estimates (`costEstimate`: the sum, the cut sessions, how many of them could be estimated, the estimate per
  session). The cost meter's **+N unmeasured** becomes an amber dot that says, on hover or click, how many sessions
  ended before reporting and about how much they cost (**≈**). The task total adds **+ ≈$x est.**; a cut session's row
  shows **≈$x**, or **unknown** where there is no rate.
- **Never a measurement.** An estimate is never added to a total, a ledger row, the Usage page or the budget check. The
  ledger keeps $0 with `cost_status: 'unavailable'`, as ADR-0037 has it.

## Consequences

- The person sees roughly how big the unmeasured part is, at the prices and discounts their own sessions were charged,
  so nothing needs updating when prices change. An estimate is only as good as what was measured: a model this instance
  never ran with a reported cost gets none until it has, and a new model takes its family's rate until then.
- The weights are fixed in code. A model priced at other ratios, or a session that wrote hour-long cache entries (2× an
  input token, not 1.25×), is estimated off by that much.
- Estimates are worked out when the goal detail is read, from one grouped query over the ledger, and stored nowhere;
  they move as more sessions report.
- A USD budget is still enforced against reported costs only. Codex reports no dollar cost and gets no estimate.
