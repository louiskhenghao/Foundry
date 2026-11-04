---
name: Captioned clip
summary: A recording you attach — a talk, a demo, a voice note — cut into a clip with captions, callouts and a hook.
nature: video
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: recording
    label: The recording
    help: Attach it to the goal below (a screen recording, a talking-head video, an audio file). Say here what it is.
    example: A 6-minute screen recording of me walking through the new billing page, with my voice.
  - key: keep
    label: What to keep
    type: textarea
    help: The moments or points the clip must carry; the rest can go.
    example: The part where I show the reminder schedule, and the line about never chasing by hand again.
  - key: duration
    label: Length of the clip
    type: choice
    options: [30 s, 60 s, 90 s, up to 3 min]
    default: 60 s
  - key: formats
    label: Formats
    type: choice
    options: ["9:16", "16:9", "16:9 and 9:16", "1:1"]
    default: 9:16
  - key: language
    label: Language of the captions
    default: the recording's language
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, fonts, logo; attach files below if you have them.
    example: Ink blue #1b2a49 and paper white, the wordmark in a geometric sans.
---

Cut the attached recording into a {{duration}} clip.

## The recording
{{recording}}

## What to keep
{{keep}}

## Formats
{{formats}}

## Captions
Word by word, in {{language}}, from a transcript made on this computer; a callout where a number or a name matters.

## Brand
{{brand}}

## Already decided
- Opens on the strongest moment, not the beginning; the dead air and the hesitations are cut.
- The recording's own sound carries the clip, levelled; music under it only where it says nothing.
- Captions stay inside the title-safe box and never cover a face or the thing being shown.
