---
name: Research report
summary: An investigation of one question, ending in a cited report with a clear answer and what it rests on.
nature: research
settings:
  mode: simple
inputs:
  - key: question
    label: The question
    type: textarea
    help: What you need to know, as precisely as you can put it. One question per report.
    example: Which database should a small team pick for an app that must work offline on phones and sync when back online, and what does each choice cost in operations?
  - key: scope
    label: Include and exclude
    type: textarea
    required: false
    help: Time span, regions, products or sources to include or leave out.
    example: Open-source or free-tier options only; releases from the last three years; leave out anything that needs its own server team.
  - key: sources
    label: Sources allowed
    type: choice
    options: [official documentation and peer-reviewed work only, "official documentation, papers and reputable press", anything credible with its reliability noted]
    default: "official documentation, papers and reputable press"
  - key: length
    label: Length
    type: choice
    options: [one page, three to five pages, as long as the question needs]
    default: three to five pages
  - key: decision
    label: The decision it informs
    required: false
    help: What you will do with the answer, so the report weighs what matters to that.
    example: We pick the database for the next release and will not change it for two years.
---

Research this question and write a report with citations.

## The question
{{question}}

## Include and exclude
{{scope}}

## Sources allowed
{{sources}}

## Length
{{length}}

## The decision it informs
{{decision}}

## Already decided
- Start with the answer and how sure it is, then the evidence, then what would change the answer.
- Every claim that is not common knowledge carries a citation a reader can open; quotes are exact.
- Where sources disagree, say so and say which you trust more and why.
