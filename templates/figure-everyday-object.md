---
name: An everyday object
summary: A figure of a familiar object that does what the real one does when you play with it.
nature: figure
settings:
  mode: simple
inputs:
  - key: object
    label: The object
    help: A toaster, a desk lamp, a vending machine, an arcade cabinet.
  - key: does
    label: What it does when played with
    type: textarea
    help: What happens when the viewer presses, pulls, turns or drops something, in order.
  - key: look
    label: Look
    type: textarea
    required: false
    help: Colour, material, era, a brand it resembles; what it must not look like.
  - key: page_name
    label: File name
    required: false
    help: The name of the page's file, without .html.
---

Draw a playable figure of {{object}}.

## What it does when played with
{{does}}

## Look
{{look}}

## File name
{{page_name}}

## Already decided
- Drag to turn the object all the way round; every control does what the real one does.
- One self-contained web page: it opens anywhere, works on a phone, and carries no credit line.
- The proportions are the real object's; take them from a reference before drawing.
