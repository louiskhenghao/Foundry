---
name: Architecture diagram
summary: One editorial diagram of how a system is put together — its parts and what talks to what — as a web page with an SVG beside it, ready for a README or a docs page.
nature: diagram
settings:
  mode: simple
inputs:
  - key: system
    label: The system
    help: What the diagram shows: a product, a service, a pipeline.
    example: our order service and what it talks to
  - key: parts
    label: The parts and their connections
    type: textarea
    help: The components, in words, and what calls or feeds what. Nine parts at most; over that it becomes two diagrams.
    example: |
      - The web app and the mobile app call the API gateway.
      - The gateway routes to the orders service and the catalog service.
      - The orders service writes to Postgres and publishes events to a queue.
      - A worker reads the queue and sends emails through SendGrid.
  - key: focus
    label: What the reader should notice first
    required: false
    help: One or two things the accent colour goes on.
    example: the queue and the worker, which are new
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

Draw an architecture diagram of {{system}}.

## The parts and their connections
{{parts}}

## What the reader should notice first
{{focus}}

## Where it will be read
{{destination}}

## Look
{{skin}}

## Brand
{{brand}}

## Already decided
- One self-contained web page with the SVG exported beside it, committed in the repository under docs/diagrams/.
- Every part is a distinct idea and every line carries information; what the layout already says is not drawn.
- The accent colour sits on one or two elements, never on everything that matters.
