---
name: Kinetic-type explainer
summary: Words in motion that explain one thing, to a rhythm, in the colours you choose.
nature: video
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: topic
    label: What it explains
  - key: script
    label: The words
    type: textarea
    help: The script, or the points to make in order. Short sentences move best.
  - key: duration
    label: Length
    type: choice
    options: [30 s, 45 s, 60 s, 90 s]
    default: 45 s
  - key: formats
    label: Formats
    type: choice
    options: ["16:9", "9:16", "16:9 and 9:16"]
    default: 16:9 and 9:16
  - key: rhythm
    label: Rhythm
    type: choice
    options: [calm, brisk, punchy]
    default: brisk
  - key: palette
    label: Colours and type
    required: false
    help: Two or three colours and a font family, or a brand to take them from.
---

Make a {{duration}} kinetic-type explainer about {{topic}}.

## The words
{{script}}

## Formats
{{formats}}

## Rhythm
{{rhythm}}

## Colours and type
{{palette}}

## Already decided
- Every word on screen is readable at a glance on a phone; one idea on screen at a time.
- The motion follows the meaning: emphasis lands on the beat, pauses where the script breathes.
- One timeline; every format is cut from it, never cropped from another.
