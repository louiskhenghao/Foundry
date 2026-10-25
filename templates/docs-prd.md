---
name: Product requirements document
summary: A PRD that states the problem, who has it, what is in and out of scope, and how success will be measured.
nature: docs
settings:
  mode: simple
  interviewDepth: 3
inputs:
  - key: product
    label: The product or feature
  - key: problem
    label: The problem
    type: textarea
    help: What is wrong or missing today, for whom, and what it costs them.
  - key: users
    label: Who it is for
    help: The people who will use it, and the ones who decide to.
  - key: scope
    label: In scope
    type: textarea
    help: What the first version does, one capability per line.
  - key: out_of_scope
    label: Out of scope
    type: textarea
    required: false
    help: What it deliberately does not do, so nobody asks later.
  - key: success
    label: How success is measured
    type: textarea
    required: false
    help: The numbers or observations that will tell you it worked.
---

Write a product requirements document for {{product}}.

## The problem
{{problem}}

## Who it is for
{{users}}

## In scope
{{scope}}

## Out of scope
{{out_of_scope}}

## How success is measured
{{success}}

## Already decided
- Structure: summary, problem, users, goals and non-goals, requirements (must / should / could), open questions, success measures.
- Requirements are testable statements, each with a reason; no solution design beyond what the reader needs to judge them.
- Written in plain words a new team member understands on first reading.
