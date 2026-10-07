# ADR-0027: The interview has a depth, not a round count

**Status:** accepted · 2026-10-07 · amends ADR-0013

## Context

ADR-0013 gave the Clarify interview three modes (auto, always, never) and a cap of four rounds. People wanted to choose
how thoroughly they are questioned: sometimes only what would waste the goal, sometimes every detail. A round count
does not express that: four rounds of shallow questions are not a deep interview, and a deep one can be over in one.

## Decision

- An interview has a depth from 1 to 5, chosen per goal (default from Settings, 3); 0 is no interview. The depth goes
  into the Clarifier's instructions as how far to probe: 1 only what a wrong guess would waste, 3 the decisions that
  shape the result (the old auto), 4 also edge cases and data and at least one round (the old always), 5 every area
  down to its details, round after round, at least two rounds, until nothing is left or the human stops it.
- The depth does not set a number of rounds. The cap rises from 4 to 10 and stays only as a safety net.
- The older modes map onto depths (never 0, auto 3, always 4): a Settings file or an API call that still uses them
  keeps working, and goals created before keep their behaviour.

## Consequences

- At depth 5 an interview can take many rounds and cost more; the human can always end it with **Enough — write the Brief**.
