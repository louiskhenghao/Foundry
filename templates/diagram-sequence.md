---
name: Sequence diagram
summary: One editorial sequence diagram of how a request or an event travels between actors, in time order — who calls whom, what comes back, where it waits — as a web page with an SVG beside it.
nature: diagram
settings:
  mode: simple
inputs:
  - key: flow
    label: The flow
    help: What travels, from where to where, in a few words.
    example: placing an order, from the checkout button to the confirmation email
  - key: actors
    label: The actors, left to right
    help: The people, services and systems that take part, in the order they should stand. Six at most.
    example: Customer, Web app, API gateway, Orders service, Queue, Email worker
  - key: messages
    label: The messages, in order
    type: textarea
    help: Each message on a line, from one actor to another, with its reply when there is one and anything asynchronous or optional marked. Twelve at most.
    example: |
      1. Customer -> Web app: presses Place order.
      2. Web app -> API gateway: POST /orders.
      3. API gateway -> Orders service: create order.
      4. Orders service -> Orders service: writes the order (Postgres).
      5. Orders service -> Queue: order.placed (async).
      6. Orders service -> API gateway -> Web app: 201 Created; the customer sees the confirmation page.
      7. Queue -> Email worker: order.placed (later).
      8. Email worker -> Customer: the confirmation email.
  - key: focus
    label: What the reader should notice first
    required: false
    help: One message or one actor the accent colour goes on.
    example: the asynchronous hand-off through the queue
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

Draw a sequence diagram of {{flow}}.

## The actors, left to right
{{actors}}

## The messages, in order
{{messages}}

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
- Time runs downwards; every message is labelled with what it carries, replies and asynchronous messages are drawn as the skill's sequence reference says.
- The accent colour sits on one message or one actor, never on all of them.
