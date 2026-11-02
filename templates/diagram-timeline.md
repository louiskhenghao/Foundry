---
name: Timeline or roadmap
summary: One editorial timeline of what happened when, or what comes when — a project's history, a release plan, a migration in phases — as a web page with an SVG beside it.
nature: diagram
settings:
  mode: simple
inputs:
  - key: subject
    label: The subject
    help: Whose time this is: a project, a product, a migration.
    example: the move from the old checkout to the new one
  - key: events
    label: The events or phases, in order
    type: textarea
    help: Each on a line with its date or its span; group them into phases when there are many. Twelve at most.
    example: |
      - 2026-03: the new checkout behind a flag, for staff only.
      - 2026-05: 10% of customers; the old checkout still takes the rest.
      - 2026-07: 50%; refunds move to the new flow.
      - 2026-09: everyone; the old checkout reads only.
      - 2026-11: the old checkout is removed.
  - key: today
    label: Where we are now
    required: false
    help: The date or phase to mark as the present, if the timeline runs into the future.
    example: 2026-09, the rollout to everyone
  - key: destination
    label: Where it will be read
    type: choice
    options: ["a README or a docs page", "a wiki page, full width", "a slide", "a link card on social media"]
    default: "a README or a docs page"
  - key: skin
    label: Look
    type: choice
    options: ["minimal light", "minimal dark", "full editorial, with a header and summary cards"]
    default: "minimal light"
  - key: brand
    label: Brand
    required: false
    help: A website address whose colours and fonts the diagram should follow; leave empty for the skill's own palette.
    example: https://example.com
---

Draw a timeline of {{subject}}.

## The events or phases, in order
{{events}}

## Where we are now
{{today}}

## Where it will be read
{{destination}}

## Look
{{skin}}

## Brand
{{brand}}

## Already decided
- One self-contained web page with the SVG exported beside it, committed in the repository under docs/diagrams/.
- Dates are drawn as given; the spacing follows the calendar where it matters and the reading order where it does not.
- The accent colour marks the present, or the one event the reader should see first.
