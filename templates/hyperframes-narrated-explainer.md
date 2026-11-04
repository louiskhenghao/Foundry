---
name: Narrated explainer
summary: A short film that explains one thing in a voice made on this computer, with captions, cut to a beat.
nature: video
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: subject
    label: What it explains
    help: The one thing the film makes clear, in a line.
    example: How Ledgerly chases a late invoice, step by step
  - key: script
    label: The script, or the points to cover
    type: textarea
    help: Paste the words to be spoken, or the points and let the film write them. Around 40 words per 15 seconds.
    example: Send the invoice once. Ledgerly reminds the client, politely, every few days. When it is paid, you hear about it first.
  - key: url
    label: Where to see it
    required: false
    help: A site or app the film can take its real screens and colours from.
    example: https://app.example.com
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
  - key: voice
    label: The voice
    type: choice
    options: [a neutral voice, a warm voice, a brisk voice]
    default: a neutral voice
  - key: language
    label: Language of the voice and captions
    default: English
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, fonts, logo, the voice of the brand; attach files below if you have them.
    example: Ink blue #1b2a49 and paper white, the wordmark in a geometric sans; calm, dry, never salesy.
---

Make a {{duration}} narrated explainer about {{subject}}.

## The words
{{script}}

## Where to see it
{{url}}

## Formats
{{formats}}

## Voice and language
{{voice}}, in {{language}}; captions on screen, word by word, in the same language.

## Brand
{{brand}}

## Already decided
- The narration is made on this computer (no key, no account); every caption line stays inside the title-safe box and lands with the voice.
- Real screens of the product, never mock-ups; one idea per shot, the picture changes when the sentence does.
- Ends on the product's name and one line, held long enough to read.
