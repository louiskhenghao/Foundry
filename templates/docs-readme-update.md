---
name: README update
summary: Bring the README up to date for the people who read it, covering what they need and nothing more.
nature: docs
settings:
  mode: simple
  budgetPreset: quick
inputs:
  - key: audience
    label: Who reads it
    type: choice
    options: [newcomers trying it for the first time, contributors who change the code, people who run it, all of them]
    other: true
  - key: cover
    label: What it must cover
    type: textarea
    help: The things a reader must learn, one per line. Mention anything that changed recently.
  - key: tone
    label: Tone
    type: choice
    options: [plain and short, friendly, formal]
    default: plain and short
  - key: keep
    label: Keep as it is
    type: textarea
    required: false
    help: Sections or wording that must stay.
---

Update the README for {{audience}}.

## It must cover
{{cover}}

## Tone
{{tone}}

## Keep as it is
{{keep}}

## Already decided
- Say what the project does in the first five lines, then how to run it, then how to use it.
- Every command shown is one that works in this repository today; check it.
- Remove what is out of date instead of adding beside it.
