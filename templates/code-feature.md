---
name: New feature
summary: A feature described the way a senior engineer would want it, from who it is for to how you will know it works.
nature: code
inputs:
  - key: feature
    label: The feature
    help: One line, as you would name it in a changelog.
    example: CSV export of the orders page
  - key: users
    label: Who uses it
    help: The people or systems that will use it, and what they are trying to do.
    example: Shop managers who reconcile the month's orders in a spreadsheet.
  - key: behaviour
    label: How it should behave
    type: textarea
    help: Step by step, as a person would experience it. Name the screens, commands or endpoints you already know.
    example: |
      On the Orders page an Export button sits next to the date filter. Pressing it downloads a CSV of the orders in view, with the same columns as the table and one row per order. The file is named orders-<from>-<to>.csv. Over 10,000 rows, the export runs in the background and the page says when it is ready.
  - key: constraints
    label: Constraints
    type: textarea
    required: false
    help: What must not change, what it must work with, limits on time, size or cost.
    example: The table itself does not change. Amounts are exported as numbers, not formatted strings. Opens cleanly in Excel and Numbers.
  - key: done_when
    label: Done when
    type: textarea
    required: false
    help: How you will know it works. Each line can become an acceptance check.
    example: |
      Exporting a filtered week gives exactly the rows the table shows.
      An export of 50,000 orders finishes without timing out.
---

# Feature: {{feature}}

## Who it is for
{{users}}

## How it should behave
{{behaviour}}

## Constraints
{{constraints}}

## Done when
{{done_when}}

## Already decided
- Fit the feature into the existing code and conventions; do not restructure what works.
- Keep the change reviewable: small commits, each with a reason.
- Tests cover the behaviour above, not the implementation details.
