---
name: Feature tour of an app
summary: A film that walks through an app's features on its real screens — camera moves, callouts and captions, one feature per beat — in every format you post.
nature: video
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: The app
    help: Its name and what it does, in a line.
    example: Orbit, subscription analytics for online shops
  - key: url
    label: Where to see it
    help: The app's address, or a demo account, so the film is made from real screens.
    example: https://demo.example.com (sign-in demo / demo)
  - key: features
    label: The features, in order
    type: textarea
    help: One per line: what to show and the one sentence to say about it.
    example: |
      The overview — "Your MRR, churn and active shops, this morning."
      Compare — "Any range against last year, one toggle."
      Drill down — "From a dip in the chart to the exact orders behind it."
      Digest — "Every Monday, the week in your inbox."
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
  - key: captions
    label: Words on screen
    type: choice
    options: [captions for every beat, a title per feature only]
    default: captions for every beat
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, fonts, logo, the voice; attach files below if you have them.
    example: Slate and off-white, one accent in teal; the wordmark in a geometric sans; captions short, present tense, no exclamation marks.
---

Make a {{duration}} feature tour of {{product}}.

## Where to see it
{{url}}

## The features, in order
{{features}}

## Formats
{{formats}}

## Words on screen
{{captions}}

## Brand
{{brand}}

## Already decided
- Real screens, captured from the app above at the formats' resolutions, never redrawn; data in the screens is plausible and consistent across beats.
- One beat per feature: a camera move into the part of the screen that matters, a callout where the eye should go, the caption in the brand's voice; cuts on the score's beat.
- One timeline; every format is cut from it, never cropped from another; captions re-laid for the portrait formats.
- Ends on the product's name, one line and the address, held long enough to read.
