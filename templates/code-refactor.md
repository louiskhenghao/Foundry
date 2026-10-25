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
    example: the notifications module (src/notify/*)
  - key: why
    label: Why
    type: textarea
    help: What is hard today that should be easy afterwards.
    example: Every channel (email, chat, webhook) repeats the same retry and formatting code, so a change to the retry policy is made three times and one is always forgotten. Adding a fourth channel should mean one file.
  - key: keep
    label: What must not change
    type: textarea
    required: false
    help: Behaviour, public interfaces, file formats, performance that other code or people depend on.
    example: The message texts, the retry count and the public send() signature. The existing notification tests pass unchanged.
  - key: stop_at
    label: Stop at
    required: false
    help: The edges of the change. Anything beyond them is out of scope, however tempting.
    example: The channels' own HTTP clients stay as they are.
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
