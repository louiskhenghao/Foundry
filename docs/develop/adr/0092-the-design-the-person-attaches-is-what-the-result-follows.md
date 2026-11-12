# ADR-0092: The design the person attaches is what the result follows

**Status:** accepted · 2026-11-12 · builds on [ADR-0005](0005-scenario-skills-and-settings.md) and [ADR-0076](0076-figure-goals-from-a-bundled-figure-pack.md)

## Context

A person designed their screens in Claude Design, pasted the share link into a goal's description, and got a result
two days later that was "not as perfect as expected, mostly the UX". The link was the whole design input. Foundry's
sessions cannot open a claude.ai page (it needs a sign-in and draws itself in the browser), so no role ever saw the
design. The Clarifier did what it does for every UI goal: it invented two to four style directions and asked the
person to pick one; the Design pack then told the worker to "choose a deliberate aesthetic direction". Both filled the
vacuum the missing design left. The result was the agents' design, not the person's.

What the code did with an attached design, when one was attached, was not much better:

- An attachment is a path in a markdown section of each role's prompt, listed after the chosen style direction. A
  mockup weighs the same as a reference PDF; nothing says it is the design, and nothing says the design beats the
  style cards or the pack's instruction to pick a direction.
- A zip (what design tools export) was never unpacked.
- The Clarifier proposed invented style cards whether or not a design was attached, and the person had to pick one.
- The Design pack is one global Settings value; a goal could not choose another.

The person's own design is the most precise brief a UI goal can get. Treating it as one reference among others, and
letting a skill re-choose the direction, wastes it.

## Decision

1. **A design reference is a marked attachment.** An attachment carries `design: true` when it is the design the
   result follows. The New goal form and the goal page mark a picture, an HTML page or a zip as the design reference
   when it is attached (the person unticks the chip to keep it an ordinary reference), and `POST
   /api/goals/:id/attachments/:attId/mark` changes the mark later. A link is never the design.
2. **A zip is unpacked when it is staged.** Its files land in a folder beside it (junk, escaping entries and anything
   past 2000 files or 300 MB are skipped), the folder moves with the attachment, and the record names the page to open
   first. Sessions read the files by path, as they read every attachment.
3. **The design is the law.** Every prompt that renders attachments renders the design references first, under their
   own heading, with the rule: what the design shows is made as it shows it; where the design and a style direction
   or a design skill disagree, the design wins; the skill is for what the design leaves open, done in the design's own
   language; an HTML reference is source material to port, never a file to commit. The worker prompt places that
   section right after the task, before the style direction, and the style direction says it was read from the design.
4. **Clarify reads the design instead of inventing a direction.** With a design attached, the Clarifier outputs one
   style card read from it ("From your design"), already picked, never a choice among invented ones; writes a design
   inventory (pages, components, states, copy) into its planning notes; adds a goal-level reviewer check "Matches the
   design: <page>" per page the design shows; and records what the design does not show (empty, loading and error
   states, a phone width) as assumptions the person can change. The planner gives each page a task that names its
   design file and a task-level check against it. Should the Clarifier still return several cards, the engine keeps the
   one marked chosen, else the first.
5. **A link into a design tool behind a sign-in is refused as a design.** claude.ai, figma.com, canva.com and framer.com
   links are named by their tool: the New goal form warns as the link or description is typed, the prompt tells the
   sessions to treat such a link as a design that was not supplied, and the Brief gets an engine-generated blocking
   question asking for an export (or to go without) whenever such a link is present and no design is attached.
6. **A goal may pick its Design pack.** `designPack` on the goal (the New goal form's **Design skills**, the CLI's
   `--design-pack`) lays over Settings' pack the way the Figure and video packs do (ADR-0076, ADR-0077). It is not the
   fix for the feedback above; it is the cheap thing people asked for, and with a design attached the pack only fills
   what the design leaves open.

## Consequences

- A goal with a design attached asks the person nothing about its look. The Brief shows one card and the inventory's
  gaps as assumptions; the person edits those instead of choosing between directions nobody asked for.
- Every role that builds or judges a look is told the same precedence in the same words, from one function.
- Older goals and events are unchanged: the mark and the unpacked folder are optional fields, read as absent.
- The engine depends on `fflate` (MIT) to read zips: Bun's archive reader takes tar only, and the Docker image has no
  `unzip`.
- The comparison of the built screens against the design (screenshots for the task reviewer and the goal reviewer,
  the design carried into Adjust and Revise) is a decision of its own and a later ADR; this one makes the design reach
  the sessions and bind the plan.
