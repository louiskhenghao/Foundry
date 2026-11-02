---
name: Chart from data
summary: One editorial chart — a bar, line, scatter, waterfall, treemap, heatmap, Sankey or Gantt — drawn from the numbers you give, as a web page with an SVG beside it.
nature: diagram
settings:
  mode: simple
inputs:
  - key: question
    label: What the chart answers
    help: The one thing a reader should take from it.
    example: which plan brings most of the revenue, and how that changed this year
  - key: data
    label: The data
    type: textarea
    help: The numbers, as a small table or a list, with their units; or the file in the repository that holds them.
    example: |
      Plan, 2025, 2026 (revenue, $k)
      Starter, 120, 140
      Team, 310, 420
      Enterprise, 260, 390
  - key: kind
    label: Kind of chart
    type: choice
    options: ["let the skill choose", "bar", "line", "scatter", "waterfall", "treemap", "heatmap", "Sankey", "Gantt"]
    default: "let the skill choose"
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

Draw a chart that answers: {{question}}.

## The data
{{data}}

## Kind of chart
{{kind}}

## Where it will be read
{{destination}}

## Look
{{skin}}

## Already decided
- One self-contained web page with the SVG exported beside it, committed in the repository under docs/diagrams/.
- The numbers are drawn as given, with their units on the axis; nothing is invented to fill a gap.
- The accent colour marks the one series or bar the question is about.
