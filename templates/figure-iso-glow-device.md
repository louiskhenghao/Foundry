---
name: A device in glowing line art
summary: An isometric figure in the iso-glow style — a dark hairline drawing, flat or in real 3D, where whatever is live glows in one accent colour — of a device that works when you touch it.
nature: figure
settings:
  figurePack: iso-glow
  mode: simple
inputs:
  - key: object
    label: The device
    help: A synthesiser, a server rack, a radio, a lift panel, a vending machine at night.
    example: a tabletop synthesiser with a small screen
  - key: live
    label: What is live
    type: textarea
    help: What glows when the device works — screens, pressed keys, lamps, beams, wires carrying signal — and when.
    example: |
      The screen shows a waveform that moves while a note plays.
      The key being pressed glows, and the LED above the active oscillator.
      A wire from the output jack glows while sound is going out.
  - key: interactions
    label: What the viewer can do
    type: textarea
    help: Keys to press, knobs to turn, switches to flip; what each does.
    example: Press keys to play (the waveform changes), turn the filter knob (the waveform smooths), flip the power switch (everything dark until it is on).
  - key: form
    label: Flat or 3D
    type: choice
    options: ["flat isometric line art (SVG)", "real 3D (three.js: orbit it, revolve it, a true isometric view)"]
    default: flat isometric line art (SVG)
  - key: accent
    label: Accent colour
    type: choice
    options: [ember, cyan, lime, violet, rose, ice]
    default: ember
  - key: inside
    label: Inside view
    type: choice
    options: ["yes, a see-through of the circuit board and wiring", "no, the outside only"]
    default: "no, the outside only"
---

Draw {{object}} as an iso-glow figure.

## What is live
{{live}}

## What the viewer can do
{{interactions}}

## Flat or 3D
{{form}}

## Accent colour
{{accent}}

## Inside view
{{inside}}

## Already decided
- The iso-glow look, exactly: a monochrome hairline drawing on a dark panel, one accent colour only on what is live, and live things glow; nothing glows that is not on.
- The figure does something: every control the viewer can touch changes what is live, and the figure starts in a plausible state (off, or idle).
- One web page: it opens anywhere, works on a phone, and carries no credit line; the palette picker stays so the accent can be changed. The flat form is self-contained; the 3D form loads three.js from the web once.
- Research the real device first: its proportions and its controls are the real ones.
