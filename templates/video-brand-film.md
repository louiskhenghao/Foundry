---
name: Brand film
summary: A film about what a brand stands for, told in a few beats, with its colours and its voice.
nature: video
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: brand
    label: The brand
    example: Ridgeline, outdoor gear made to be repaired
  - key: story
    label: The story
    type: textarea
    help: What the brand stands for, told in three beats, where it comes from and where it is going.
    example: |
      A jacket that tore on its first trip, and the workshop that fixed it instead of selling a new one.
      Ten years of gear designed so every part can be replaced, and the repair counter that never closed.
      The next decade: spare parts for everything we ever made, for as long as someone wears it.
  - key: duration
    label: Length
    type: choice
    options: [45 s, 60 s, 90 s]
    default: 60 s
  - key: formats
    label: Formats
    type: choice
    options: ["16:9", "9:16", "16:9 and 9:16", "16:9, 9:16 and 1:1"]
    default: 16:9 and 9:16
  - key: mood
    label: Mood
    type: textarea
    help: Calm or urgent, warm or precise; films or brands whose feel you want, and ones to avoid.
    example: Calm and warm, unhurried cuts, daylight and workshop textures; nothing epic, no drone shots, no swelling strings.
  - key: end_card
    label: The closing line
    help: The words the film ends on, exactly.
    example: Made to be repaired.
  - key: assets
    label: Assets
    type: textarea
    required: false
    help: Logo, colours, fonts, footage or photographs you will attach below.
    example: The wordmark (SVG), slate blue #35506b and burnt orange #c2561f, twelve workshop photographs attached.
---

Make a {{duration}} brand film for {{brand}}.

## The story
{{story}}

## Formats
{{formats}}

## Mood
{{mood}}

## The closing line
{{end_card}}

## Assets
{{assets}}

## Already decided
- The brand's own colours and type throughout; the logo appears once, at the end.
- One timeline; every format is cut from it, never cropped from another.
- The score is written to the beats of the story, not laid under it.
