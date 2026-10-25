---
name: Product reel
summary: A short film that shows a product off, cut to music, in every format you post.
nature: video
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: The product
    help: Its name and what it does, in a line.
    example: Ledgerly, invoicing for freelancers that chases late payers for you
  - key: url
    label: Where to see it
    required: false
    help: A site or app the film can take its real screens and colours from.
    example: https://app.example.com
  - key: duration
    label: Length
    type: choice
    options: [15 s, 30 s, 45 s, 60 s]
    default: 30 s
  - key: formats
    label: Formats
    type: choice
    options: ["16:9", "9:16", "16:9 and 9:16", "16:9, 9:16 and 1:1"]
    default: 16:9 and 9:16
  - key: message
    label: The one thing to remember
    type: textarea
    help: What a viewer should be able to say about the product after watching.
    example: Send the invoice once; Ledgerly does the reminding, politely, until it is paid.
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, fonts, logo, the voice of the brand; attach files below if you have them.
    example: Ink blue #1b2a49 and paper white, the wordmark in a geometric sans; calm, dry, never salesy.
  - key: music
    label: Music
    type: choice
    options: [a score made on the beat, my own track (attached below)]
    default: a score made on the beat
---

Make a {{duration}} product reel for {{product}}.

## Where to see it
{{url}}

## Formats
{{formats}}

## The one thing to remember
{{message}}

## Brand
{{brand}}

## Music
{{music}}

## Already decided
- Real screens of the product, never mock-ups; the hook lands in the first two seconds.
- One timeline; every format is cut from it, never cropped from another.
- Ends on the product's name and one line, held long enough to read.
