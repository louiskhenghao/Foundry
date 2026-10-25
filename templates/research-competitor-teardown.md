---
name: Competitive teardown
summary: A side-by-side teardown of the products in a category — features, pricing, positioning, weaknesses — with evidence for every cell and a view on where the gap is.
nature: research
settings:
  mode: simple
inputs:
  - key: category
    label: The category
    help: The kind of product and the market, in a line.
    example: invoicing tools for freelancers in Europe
  - key: competitors
    label: The products to compare
    type: textarea
    help: Names and links, one per line; the report may add one it finds you missed.
    example: |
      Four to six well-known tools in the category, with their websites.
      Include one open-source option if there is a credible one.
  - key: criteria
    label: What to compare
    type: textarea
    help: The features, prices, qualities and signals that matter to you; the report adds the ones the market considers standard.
    example: Automatic reminders, recurring invoices, payment links, multi-currency, tax handling by country, mobile app, price per month at one, five and twenty clients, free plan, time to first invoice, support channels.
  - key: evidence
    label: Evidence allowed
    type: choice
    options: [public pages and documentation only, public pages plus trial accounts where free, public pages plus reviews and forums]
    default: public pages plus trial accounts where free
  - key: decision
    label: The decision it informs
    help: What you will do with the teardown.
    example: Decide which three features to build next quarter and how to position the pricing page.
---

Tear down the competition in {{category}}.

## The products to compare
{{competitors}}

## What to compare
{{criteria}}

## Evidence allowed
{{evidence}}

## The decision it informs
{{decision}}

## Already decided
- Start with the findings: where the products agree, where they differ, where nobody is good — and the recommendation for the decision above.
- One feature matrix with a cell for every product and criterion: yes, no, partly (with a note), or unknown; every cell links to its evidence (a page, a screenshot taken for the report, a quote with its date).
- Pricing is normalised to the same scenarios (one, five and twenty clients, monthly) in one currency, with the date the prices were read.
- Positioning is quoted, not paraphrased: each product's own headline and who it says it is for.
- Weaknesses come from evidence (reviews, changelogs, missing docs), never from guesswork; the report says what it could not verify.
- Delivered as a Markdown report with the matrix as a table and as a CSV beside it, and a one-page summary for people who will not read the rest.
