---
name: Refactor
summary: Change the shape of the code without changing what it does, with clear edges and a clear reason.
nature: code
settings:
  interviewDepth: 2
inputs:
  - key: area
    label: What to refactor
    help: A module, a folder, a class or a flow.
  - key: why
    label: Why
    type: textarea
    help: What is hard today that should be easy afterwards.
  - key: keep
    label: What must not change
    type: textarea
    required: false
    help: Behaviour, public interfaces, file formats, performance that other code or people depend on.
  - key: stop_at
    label: Stop at
    required: false
    help: The edges of the change. Anything beyond them is out of scope, however tempting.
---

# Refactor: {{area}}

## Why
{{why}}

## What must not change
{{keep}}

## Stop at
{{stop_at}}

## Already decided
- Behaviour stays the same: the existing tests pass unchanged, and new tests pin anything they missed.
- Work in steps that each leave the code working; one commit per step.
- No new features ride along. Note anything found worth doing later instead of doing it.
