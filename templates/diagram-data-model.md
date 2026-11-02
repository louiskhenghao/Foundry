---
name: Data model from the code
summary: One editorial entity-relationship or database schema diagram of what the repository stores — the tables or entities, their key fields and how they relate — read from the code, as a web page with an SVG beside it.
nature: diagram
settings:
  mode: simple
inputs:
  - key: scope
    label: What to model
    help: The part of the data the diagram should cover; the whole store when it is small.
    example: orders, customers, products and payments
  - key: source
    label: Where the model lives in the code
    required: false
    help: The schema, migrations, model classes or types to read; leave empty to let the worker find them.
    example: prisma/schema.prisma
  - key: detail
    label: Detail
    type: choice
    options: ["entities and relationships only, the key fields named", "every table with its columns, types and constraints"]
    default: "entities and relationships only, the key fields named"
  - key: focus
    label: What the reader should notice first
    required: false
    help: One entity or one relationship the accent colour goes on.
    example: the many-to-many between orders and products
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
---

Draw a data model diagram of {{scope}}, read from this repository's code.

## Where the model lives in the code
{{source}}

## Detail
{{detail}}

## What the reader should notice first
{{focus}}

## Where it will be read
{{destination}}

## Look
{{skin}}

## Already decided
- One self-contained web page with the SVG exported beside it, committed in the repository under docs/diagrams/.
- Every entity and field in the diagram exists in the code; nothing is invented, and what the code leaves unclear is noted in the manifest.
- Nine entities at most on one diagram; a larger model becomes an overview and a detail diagram.
