---
name: Document to slides
summary: Turn a document you attach — a report, a paper, a spec, a long memo — into a slide deck that keeps its facts and its order, as a native, editable PPTX with speaker notes.
nature: deck
settings:
  mode: simple
inputs:
  - key: document
    label: The document
    help: Attach it to the goal (PDF, DOCX, Markdown, HTML); name it here.
    example: the Q3 platform review, attached as q3-review.pdf
  - key: audience
    label: Who the slides are for
    help: Who will see them, and whether someone presents them or they are read alone.
    example: the engineering leads, presented in a 30-minute review
  - key: keep
    label: What must survive
    required: false
    help: The parts, numbers or wording that must appear as in the document.
    example: every number in the cost table, the three recommendations word for word
  - key: length
    label: Length
    type: choice
    options: ["one slide per section, 8–12 slides", "a fuller walk-through, 15–20 slides", "as long as the document needs"]
    default: "one slide per section, 8–12 slides"
  - key: language
    label: Language
    required: false
    help: The language of the slides; leave empty for the document's.
    example: the document's
---

Turn {{document}} into a slide deck.

## Who the slides are for
{{audience}}

## What must survive
{{keep}}

## Length
{{length}}

## Language
{{language}}

## Already decided
- A native PPTX, editable in PowerPoint, 16:9, with speaker notes that carry what the slide leaves out; committed in the repository under decks/, with the drawings of its pages beside it so it can be rebuilt.
- The document's facts, numbers and order are kept; tables and figures that matter become slides of their own.
- Nothing the document does not say is added.
