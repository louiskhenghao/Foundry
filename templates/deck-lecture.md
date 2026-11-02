---
name: Lecture or training deck
summary: A teaching deck — a lecture, a workshop, an onboarding session — that builds one idea at a time, with speaker notes for whoever teaches it, as a native, editable PPTX.
nature: deck
settings:
  mode: simple
inputs:
  - key: topic
    label: The topic
    help: What the session teaches, in a sentence.
    example: how our deployment pipeline works, from a merged pull request to production
  - key: learners
    label: Who learns
    help: Who sits in the session and what they already know.
    example: new backend engineers in their first month; they know git and Docker, not our tooling
  - key: outcomes
    label: What they should be able to do afterwards
    type: textarea
    help: Two to five concrete abilities; the deck is organised around them.
    example: |
      - Trace a change from merge to the production rollout, naming each stage.
      - Read the pipeline dashboard and tell a stuck deploy from a slow one.
      - Roll a deploy back safely, and know when to.
  - key: materials
    label: Materials to draw on
    required: false
    help: Documents attached to the goal, or places in the repository, the content comes from.
    example: docs/deploy.md and the attached runbook
  - key: length
    label: Length
    type: choice
    options: ["a 20-minute talk, 10–12 slides", "a 45-minute session, 18–25 slides", "a half-day workshop, 30–40 slides with exercises"]
    default: "a 45-minute session, 18–25 slides"
  - key: language
    label: Language
    required: false
    help: The language of the slides; leave empty for the language you write in.
    example: English
---

Make a teaching deck on {{topic}}.

## Who learns
{{learners}}

## What they should be able to do afterwards
{{outcomes}}

## Materials to draw on
{{materials}}

## Length
{{length}}

## Language
{{language}}

## Already decided
- A native PPTX, editable in PowerPoint, 16:9, with speaker notes that say what to tell and ask on each slide; committed in the repository under decks/, with the drawings of its pages beside it so it can be rebuilt.
- One idea per slide, built up in the order a learner needs; a recap slide per outcome, and a closing slide that names where to look next.
- Examples come from the materials named, never invented.
