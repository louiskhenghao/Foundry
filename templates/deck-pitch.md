---
name: Pitch deck
summary: A slide deck that makes one case to a room — an investor pitch, a sales deck, a proposal — as a native, editable PPTX with speaker notes, from your points and any documents you attach.
nature: deck
settings:
  mode: simple
inputs:
  - key: pitch
    label: What you are pitching
    help: The product, project or proposal, in a sentence.
    example: Foundry, a goal-driven harness for coding agents
  - key: audience
    label: Who is in the room
    help: Who decides, and what they already know.
    example: seed-stage investors who know developer tools but have not seen Foundry
  - key: ask
    label: The one thing you want from them
    help: The decision or action the deck must earn.
    example: a second meeting with the partnership and a term sheet within the month
  - key: points
    label: The points, in order
    type: textarea
    help: The argument slide by slide, roughly; attach documents with the facts and the deck draws on them.
    example: |
      1. The problem: teams spend their senior engineers' time babysitting coding agents.
      2. The product: describe a goal, approve a plan, get a branch.
      3. Traction: 40 goals a week across three teams, 70% merged without edits.
      4. How it works, in one picture.
      5. The market and who else is there.
      6. The team.
      7. The ask and what it buys.
  - key: length
    label: Length
    type: choice
    options: ["8–10 slides", "12–15 slides", "18–20 slides"]
    default: "12–15 slides"
  - key: language
    label: Language
    required: false
    help: The language of the slides; leave empty for the language you write in.
    example: English
---

Make a pitch deck for {{pitch}}.

## Who is in the room
{{audience}}

## The one thing you want from them
{{ask}}

## The points, in order
{{points}}

## Length
{{length}}

## Language
{{language}}

## Already decided
- A native PPTX, editable in PowerPoint, 16:9, with speaker notes; committed in the repository under decks/, with the drawings of its pages beside it so it can be rebuilt.
- One message per slide, the ask stated on its own slide, numbers drawn as charts where they carry the argument.
- The attached documents are the facts; nothing is invented to fill a slide.
