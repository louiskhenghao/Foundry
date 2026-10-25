---
name: Bug fix
summary: A defect described by what you saw, how to see it again and what should have happened; the fix starts from the failing test.
nature: code
settings:
  interviewDepth: 1
  workflow:
    tdd: required
inputs:
  - key: symptom
    label: What happens
    type: textarea
    help: What you saw, word for word where there is an error message.
    example: "Saving a profile with an apostrophe in the name fails with \"500 Internal Server Error\"; the name is not saved."
  - key: steps
    label: How to see it
    type: textarea
    help: The steps that make it happen, from a fresh start. Include the data or account that matters.
    example: |
      1. Sign in as any user and open Settings → Profile.
      2. Type O'Brien in the name field.
      3. Press Save.
  - key: expected
    label: What should happen instead
    example: The name is saved and shown as typed, with a "Saved" notice.
  - key: where
    label: Where it lives
    required: false
    help: A screen, URL, command, file or module, if you know it.
    example: PUT /api/profile, probably the SQL in profile-repository.ts
  - key: since
    label: Since when
    required: false
    help: A version, a date or a change you suspect.
    example: Since 2.4, when the profile form moved to the new validation.
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
