---
name: Status or review deck
summary: A reporting deck — a project update, a quarterly review, a post-mortem — that says what happened, what it means and what comes next, with the numbers as charts, as a native, editable PPTX.
nature: deck
settings:
  mode: simple
inputs:
  - key: subject
    label: What is reported on
    help: The project, period or incident.
    example: the checkout migration, Q3
  - key: readers
    label: Who it is for
    help: Who hears or reads it, and what they decide with it.
    example: the leadership team in the monthly review; they decide whether the migration keeps its budget
  - key: facts
    label: What happened
    type: textarea
    help: The facts and numbers, with their sources; attach the data and the deck charts it.
    example: |
      - Shipped: the new checkout to 50% of customers (plan: 100% by September).
      - Conversion on the new flow 3.4% vs 3.1% on the old one (dashboard export attached).
      - Two incidents, both under an hour; root causes fixed.
      - Spend: $210k of $260k.
  - key: meaning
    label: What it means and what comes next
    type: textarea
    help: Your reading of the facts, the risks, and the decisions or asks.
    example: |
      The rollout is a month late because of the payment provider's rate limits; the conversion gain holds. Ask: keep the budget, extend to November, finish at 100%.
  - key: length
    label: Length
    type: choice
    options: ["a short update, 6–8 slides", "a full review, 10–15 slides"]
    default: "a full review, 10–15 slides"
  - key: language
    label: Language
    required: false
    help: The language of the slides; leave empty for the language you write in.
    example: English
---

Make a report deck on {{subject}}.

## Who it is for
{{readers}}

## What happened
{{facts}}

## What it means and what comes next
{{meaning}}

## Length
{{length}}

## Language
{{language}}

## Already decided
- A native PPTX, editable in PowerPoint, 16:9, with speaker notes; committed in the repository under decks/, with the drawings of its pages beside it so it can be rebuilt.
- A summary slide first; every number drawn as a chart or a table with its source and period; risks and asks on slides of their own.
- Numbers are the ones given; nothing is rounded into a better story.
