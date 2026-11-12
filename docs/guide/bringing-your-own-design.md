# Bringing your own design

You already designed the screens, in Claude Design, Figma or by hand, and you want the result to look like them, not like something the agents imagined. This page says how to hand that design to a goal, and what Foundry does with it.

## Attach the files, never a link

A link to a Claude, Figma, Canva or Framer page does not work as a design. Those pages need a sign-in, so the sessions that build your goal cannot open them, and a goal that only has such a link gets the agents' own design instead. The New goal form says so as soon as the description or a link attachment points to one of those tools, and a Brief written from such a goal asks you, as a blocking question, to attach an export or to go without.

Export the design from the tool instead: an HTML file or a zip (what Claude Design and Figma give you), or screenshots of every screen. Attach the files under the description, with **Files** or by dropping or pasting them. A zip is unpacked when it arrives, so the sessions read every file in it.

## The design reference

A picture, an HTML page or a zip is marked **Design reference** when you attach it to a code goal (a goal of another kind keeps its pictures as references or Subjects; click the chip to mark one anyway). The chip on the attachment says so; click it to make the file an ordinary reference again, and click it again to make it the design. Documents and links cannot be the design. You can attach a design later from the goal page, then press **Re-run Clarify** on the Brief page so the Brief is written from it.

A design reference is the law for the goal: what it shows is built as it shows it, pages, sections, layout, copy, colours, type, components and the states it draws. An HTML export is read as source material, so the sessions port its markup, styles and tokens into your project instead of guessing them from a picture.

## What the Brief does with it

With a design attached, the Clarifier does not propose style directions for you to pick from. The Brief shows one card, **From your design**, already picked: the colours and typefaces the Clarifier read from your files. The design itself, not the card, is what the workers follow.

The Clarifier opens every design file, writes an inventory of it (each page, its sections and components, the states it shows, the copy) into its notes for the planner, and gives every page the design shows a goal-level check named **Matches the design: &lt;page&gt;**, judged by the goal reviewer. What your design does not show but the work needs, an empty list, a loading or error state, a phone width, is listed as an assumption saying how it will be done in your design's language; change any of them on the Brief page. The planner gives each page its own task, naming the design file it follows, with a check against it.

## What the workers do with it

Every worker on a page sees the design reference right after its task, before any style direction, with the rule that the design wins wherever a style direction or a design skill would say otherwise. The design skill of the goal (see [Settings explained](./settings.md#skills)) is still there, for what the design leaves open: states it does not show, how the page behaves on a phone, accessibility, motion. It fills those gaps in your design's language; it never re-chooses the direction.

## Design skills per goal

The design skill set a goal's UI tasks follow comes from Settings → Skills → **Design skills**. A code goal may pick another on the New goal form, under the kind of goal: **Design skills** lists the packs, with Settings' pack first and the ones not installed for your coding agent marked. From the command line, `foundry goal new … --design-pack bencium` does the same. With a design attached, the pack only fills what the design leaves open, whichever you pick.

## If the result still differs

Look at the result against your design page by page. Where it differs, use **Adjust the result** (beta, Settings → Beta) and name the page and the design file it should match, or **Revise** the Brief with a Decision. Both carry your words to the sessions, and the design reference stays attached to the goal for them to read.
