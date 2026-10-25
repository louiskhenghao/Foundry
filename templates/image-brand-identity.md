---
name: Brand identity kit
summary: A logo, a palette, type, and the rules for using them, explored in directions first and delivered as files a designer or a developer can use.
nature: image
settings:
  mode: simple
  budgetPreset: thorough
inputs:
  - key: brand
    label: The brand
    help: Its name, and what it does in a line.
    example: Vela, electric roadsters built in small series
  - key: personality
    label: Personality
    type: textarea
    help: Three to five words, and what the brand is not; brands whose feel you admire.
    example: Precise, quiet, confident, a little romantic. Not loud, not sporty-aggressive, not retro. Admires the restraint of good watchmaking.
  - key: uses
    label: Where it will live
    type: textarea
    help: The places the identity must work: app icon, website, car badge, documents, social.
    example: A badge on the car (metal, 40 mm), the website header, an app icon, invoices and a slide template, social avatars.
  - key: directions
    label: How many directions first
    type: choice
    options: ["2", "3", "4"]
    default: "3"
  - key: colours
    label: Colours to start from
    required: false
    help: Existing colours, or none for a free hand.
    example: Deep graphite is a given; everything else is open.
  - key: avoid
    label: Avoid
    type: textarea
    required: false
    example: Lightning bolts, leaves, generic sans-serif wordmarks in gradient blue.
---

Design a brand identity for {{brand}}.

## Personality
{{personality}}

## Where it will live
{{uses}}

## How many directions first
{{directions}}

## Colours to start from
{{colours}}

## Avoid
{{avoid}}

## Already decided
- Directions first: each one a logo, a palette and a type pairing shown in the places above, with a sentence on the idea; one is chosen before anything is refined.
- The logo works in one colour, reversed, at 16 px and at a metre; delivered as SVG (primary, mark, wordmark), with clear space and minimum size rules.
- The palette has a primary, a neutral scale and signal colours, each as hex, with contrast ratios checked for text on background.
- Type: a display and a text face that are free to use commercially, with the sizes and weights the website and documents use.
- A one-page usage sheet (do and don't) and a folder of assets named consistently; everything is also summarised in a `brand.md` a developer can read.
