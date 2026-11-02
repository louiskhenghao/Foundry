---
name: Process or flow diagram
summary: One editorial diagram of how something happens, step by step — a flow with its decisions, a sequence between actors, or a process with hand-offs — as a web page with an SVG beside it.
nature: diagram
settings:
  mode: simple
inputs:
  - key: process
    label: The process
    help: What happens, in a few words.
    example: how a refund request is handled
  - key: steps
    label: The steps, in order
    type: textarea
    help: Each step on a line, with who does it and any decision that branches. Nine steps at most.
    example: |
      1. The customer asks for a refund from the order page.
      2. Support checks the order is under 30 days old; older ones are refused with a note.
      3. For items over $200 a manager approves.
      4. Finance issues the refund and the customer gets an email.
  - key: shape
    label: Shape
    type: choice
    options: ["let the skill choose", "flowchart (decisions and branches)", "sequence (messages between actors, in time order)", "swimlanes (who does what, with hand-offs)", "timeline"]
    default: "let the skill choose"
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

Draw a diagram of {{process}}.

## The steps, in order
{{steps}}

## Shape
{{shape}}

## Where it will be read
{{destination}}

## Look
{{skin}}

## Brand
{{brand}}

## Already decided
- One self-contained web page with the SVG exported beside it, committed in the repository under docs/diagrams/.
- Connectors are orthogonal and labelled where a label adds something; the headline path gets the accent, the rest stays quiet.
- If a three-column table would say the same thing, say so instead of drawing.
