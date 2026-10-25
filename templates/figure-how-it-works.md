---
name: How does it work
summary: A playable figure of a machine or device that shows how the real thing works, step by step, inside and out.
nature: figure
settings:
  mode: simple
inputs:
  - key: object
    label: The object
    help: A kettle, a gumball machine, a bicycle gear, a lock.
    example: an electric kettle
  - key: show
    label: What it must show
    type: textarea
    help: The steps of how it works, in order, as the figure should walk a viewer through them.
    example: |
      1. The switch closes the circuit and the element under the base heats.
      2. The water warms, convects and starts to boil.
      3. Steam travels down a tube to a bimetal strip, which bends as it heats.
      4. The strip trips the switch off; the light goes out.
  - key: interactions
    label: What the viewer can do
    type: textarea
    required: false
    help: Buttons to press, levers to pull, parts to turn; what each does.
    example: Press the switch to start boiling; open the lid; drag to turn the kettle round.
  - key: inside
    label: Inside view
    type: choice
    options: ["yes, with a see-through of the mechanism and labelled parts", "no, the outside only"]
    default: "yes, with a see-through of the mechanism and labelled parts"
  - key: colour
    label: Colour
    required: false
    help: The object's colour or finish, if it matters.
    example: Brushed steel with a black handle and a blue light in the switch.
---

Draw a figure that shows how {{object}} works.

## What it must show
{{show}}

## What the viewer can do
{{interactions}}

## Inside view
{{inside}}

## Colour
{{colour}}

## Already decided
- Research how the real object works before drawing; the mechanism shown is the real one.
- One self-contained web page: it opens anywhere, works on a phone, and carries no credit line.
- Every moving part moves for a reason the viewer can see.
