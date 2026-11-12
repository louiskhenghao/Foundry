# ADR-0094: The built screens are compared with the design

**Status:** accepted · 2026-11-12 · builds on [ADR-0093](0093-the-design-the-person-attaches-is-what-the-result-follows.md), [ADR-0078](0078-adjust-the-result.md) and [ADR-0076](0076-figure-goals-from-a-bundled-figure-pack.md)

## Context

ADR-0093 made an attached design the law of a UI goal: Clarify reads it into one direction, an inventory and a
"Matches the design" check per page, and every worker gets it first. Reviewing stayed as it was: the task reviewer
read the diff alone (it never saw the design, nor any screen), and the goal reviewer had the design files but no
picture of what was built, so it judged a page's fidelity from markup. The first real case showed both halves:
the result was near pixel-identical to the mockup, and the goal reviewer found that out only by starting the app
itself and measuring, in a session that cost more than the task that built the page.

Two more things came out of that case. The Clarifier had written a must check that grepped file names for the design's
name to make sure the design export was never committed; the planner's own milestone script was named after the
design, the two checks contradicted each other, and no fix task could satisfy both. And an Adjustment on a goal with
a design was told nothing about the design, so the resumed session could have "improved" the page away from it.

Figure, diagram and deck tasks already have engine screenshots per attempt (headless Chromium over `file://`,
ADR-0076, ADR-0083, ADR-0084), handed to their reviewers as paths; frontend tasks had nothing of the kind, because
their result is a dev server, not a file.

## Decision

1. **A frontend task on a goal with a design reference is photographed before its review.** After the attempt's
   objective checks pass, Foundry starts the task's app from its own worktree the way the preview would (the
   `package.json` dev or start script, the dev server's port flag, a free high port), opens it headless at 1440 and
   390 pixels, takes full-page screenshots into the goal's screenshots folder and stops it. The goal reviewer gets the
   same shots of the merged result. No model is involved; a result that cannot be started is a note, never a failure.
2. **The reviewers compare, with one rule.** The task reviewer's prompt now carries the design reference section and a
   *Design comparison* section listing the shots, and the design files and screenshots folders are opened to it; the
   goal reviewer gets the same. A section, element or state the design shows that is missing, re-ordered or
   re-designed is a blocker; a drift of a few pixels, a shade or an opacity is a note, never a failure. The phone
   width follows the Brief's assumptions unless the design shows a phone.
3. **Foundry keeps the reference files out of the repository itself.** The goal reviewer is told which committed files
   are byte for byte one of the design reference files (git's blob hash of each reference file, an unpacked zip's
   files included, against the branch's tree) and treats them as a failing Must; the Clarifier and the planner are told
   never to write a check about the reference files, since a name pattern also matches the goal's own pages and scripts.
4. **An Adjustment keeps to the design.** The resumed session's message, the appended task's prompt and the task
   reviewer's rubric say so when the goal has a design reference, and the Adjust card says the adjustment is compared
   with it. A Revise keeps the one style card and the "Matches the design" checks and never adds a direction.
5. **One switch, on by default.** `workflow.designCheck` (Settings → New goal defaults → *Compare the screens with the
   attached design*, `FOUNDRY_DESIGN_CHECK`) turns the screenshots off; the reviewers then judge the design from the
   diff and the files and say so. The planner is told to count the comparison in the estimate.

## Consequences

- A frontend attempt on a design goal takes about a minute longer and its reviewer reads two pictures more; the goal
  review stops starting the app on its own to find out what was built.
- The comparison needs Playwright's Chromium, as the self-check and the milestone walkthroughs do; without it the
  reviewers get the note and the diff.
- A check about the reference files no longer ends a goal in a contradiction; the engine's own content check cannot be
  satisfied by renaming and cannot be fooled by a copy under another name.
- Not in this decision: waiving or editing a goal check after approval, and a pixel-level diff of the shots against a
  rendered design; the reviewer compares by eye, as the person would.
