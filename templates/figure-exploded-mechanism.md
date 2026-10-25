---
name: Exploded view of a mechanism
summary: A figure that takes a mechanism apart in the air — every part labelled, pulled out along its axis and put back — and then runs it, so a viewer learns how the pieces make it work.
nature: figure
settings:
  mode: simple
  budgetPreset: thorough
inputs:
  - key: object
    label: The mechanism
    help: A mechanical watch movement, a bicycle hub, a door lock, a camera shutter.
    example: a bicycle rear hub with a freewheel
  - key: parts
    label: The parts
    type: textarea
    help: The parts to show and label, in the order they come apart; what each does.
    example: |
      Axle and cones — the hub turns on them.
      Bearings — two rings of balls, one each side.
      Hub shell — holds the spokes.
      Freewheel body with its pawls and springs — turns the wheel forward, slips backward.
      Sprockets — where the chain pulls.
  - key: steps
    label: What the figure walks through
    type: textarea
    help: The sequence a viewer should see, from assembled to exploded and back, and the mechanism at work.
    example: |
      1. Assembled, turning slowly.
      2. Explode: parts slide out along the axle, labels appear as each stops.
      3. Pedal: the pawls catch and the shell turns with the sprockets.
      4. Coast: the sprockets stop, the pawls click over, the shell keeps turning.
      5. Reassemble.
  - key: interactions
    label: What the viewer can do
    type: textarea
    required: false
    help: A slider for the explosion, buttons for the steps, dragging to turn.
    example: A slider from assembled to exploded; Pedal and Coast buttons; drag to turn; tap a label for a sentence more.
  - key: look
    label: Look
    type: textarea
    required: false
    help: Colour, material, finish.
    example: Brushed aluminium shell, black steel sprockets, brass-coloured pawls so they stand out.
---

Draw an exploded figure of {{object}}.

## The parts
{{parts}}

## What the figure walks through
{{steps}}

## What the viewer can do
{{interactions}}

## Look
{{look}}

## Already decided
- Research the real mechanism before drawing: the parts, their order and their motion are the real ones, and the labels use the real names.
- Every part explodes along its own axis and returns to exactly where it sat; the labels stay readable at every stage and never cover a part.
- The mechanism runs: when it works, the parts that move, move, and the ones that should not, stay.
- One self-contained web page: it opens anywhere, works on a phone, and carries no credit line.
