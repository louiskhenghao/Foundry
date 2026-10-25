---
name: Bug fix
summary: A defect described by what you saw, how to see it again and what should have happened; the fix starts from the failing test.
nature: code
settings:
  budgetPreset: quick
  interviewDepth: 1
  workflow:
    tdd: required
inputs:
  - key: symptom
    label: What happens
    type: textarea
    help: What you saw, word for word where there is an error message.
  - key: steps
    label: How to see it
    type: textarea
    help: The steps that make it happen, from a fresh start. Include the data or account that matters.
  - key: expected
    label: What should happen instead
  - key: where
    label: Where it lives
    required: false
    help: A screen, URL, command, file or module, if you know it.
  - key: since
    label: Since when
    required: false
    help: A version, a date or a change you suspect.
---

# Bug: {{symptom}}

## How to see it
{{steps}}

## What should happen instead
{{expected}}

## Where it lives
{{where}}

## Since when
{{since}}

## Already decided
- Write a test that fails on the bug first, then make it pass; keep the test.
- Fix the cause, not the symptom. If the cause is elsewhere, say so instead of patching around it.
- Leave unrelated code alone.
