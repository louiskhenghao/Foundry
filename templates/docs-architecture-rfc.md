---
name: Architecture design document
summary: An RFC-style design document for a system change — the problem, the options with their trade-offs, the decision, the plan and the risks — with diagrams.
nature: docs
settings:
  mode: simple
  interviewDepth: 3
inputs:
  - key: system
    label: The system
    help: What is being changed, in a line.
    example: the order service of a mid-sized marketplace
  - key: problem
    label: The problem
    type: textarea
    help: What hurts today, with numbers where you have them.
    example: Orders are written to one Postgres and read by six services through direct queries; a schema change takes a week of coordination, and the nightly report locks the table for twenty minutes.
  - key: options
    label: The options to weigh
    type: textarea
    help: The candidates you know of; the document may add one.
    example: |
      Keep the database, add read replicas and views the other services read.
      Publish order events to a stream and let each service keep its own read model.
      Put an API in front of the database and make every service go through it.
  - key: constraints
    label: Constraints
    type: textarea
    help: What cannot change, deadlines, budgets, team skills, compliance.
    example: No downtime during the change; the team of five knows Postgres and TypeScript, not Kafka; audit needs every order change traceable for seven years.
  - key: readers
    label: Who decides and who reads
    help: The audience the document is written for.
    example: Two staff engineers decide; the whole backend team and the product lead read it.
---

# Design document: {{system}}

## The problem
{{problem}}

## The options to weigh
{{options}}

## Constraints
{{constraints}}

## Who decides and who reads
{{readers}}

## Already decided
- Structure: summary and recommendation first; context and the problem with numbers; goals and non-goals; the options, each with the same headings (how it works, cost, risks, what it rules out later); the decision and why; the migration plan in steps that each ship; risks and what would make us revisit; open questions.
- Diagrams as Mermaid in the document (current state, proposed state, the migration's middle state), each with a one-line caption.
- Every claim about load, latency or cost has a source: a measurement from the system, a benchmark run for the document, or a quoted price; estimates say they are estimates.
- Written so an engineer who joins next month understands the decision without the meeting; the recommendation is a decision, not a menu.
- Committed as `docs/design/<date>-<slug>.md` beside an ADR that records the decision once taken.
