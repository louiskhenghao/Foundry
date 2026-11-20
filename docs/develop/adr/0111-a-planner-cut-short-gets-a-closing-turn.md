# ADR-0111: A planner cut short gets a closing turn, and room to read a real repository

**Status:** accepted · 2026-11-21 · amends ADR-0028

## Context

ADR-0028 gives an unusable plan one more try in the planner's session and, when no plan comes, leaves one task per Area
and a blocking question. The more-try did not cover a planner the engine itself cut short: at its budget
(`error_max_budget_usd`), or past its idle or time limit (`killed_idle`, `killed_timeout`). Those went straight to the
one-task-per-Area stand-in, so that the budget stayed a hard stop. The budget was $4.

On 2026-11-19 two planners on Fable for a real repository were cut at that $4 after 10 and 16 turns ($4.52 and $5.27
spent, the cap is checked between turns). Each Brief became one broad task per Area with no milestones and no estimate.
It was approved as it was, and the goal reviews turned those broad tasks into 5 and 30 fix tasks: $132 and $464 for the
two goals. The dollar or so the closing turn would have cost was the cheapest part of the goal. Successful plans on the
same computers cost up to $3.55.

## Decision

- The planner session gets $10 (`PLANNER_MAX_BUDGET_USD`) and 45 turns as before.
- A planner cut short at its budget, idle or time limit (`cutShort`) gets one closing turn in its session: 4 turns and $3
  (`PLANNER_FINISH`), told to write the plan from what it read without opening more files, every Area with a task. It
  is booked as planner cost and noted on the goal. A planner the person stopped (`killed_manual`) gets none.
- The repair turn for a plan that came back unusable gets the same tight limits: it is asked only for the JSON.
- When no plan comes after all, the stand-in stays (ADR-0028); its blocking question now says what approving it is
  likely to cost (broad tasks come back from review with many fix tasks) and points at Draft on each Area.

## Consequences

- Planning a large repository may cost up to about $13 instead of $4; a Brief without a real plan is rarer.
- A planner cut short by a network outage gets a closing turn that fails the same way; the stand-in follows as before.
