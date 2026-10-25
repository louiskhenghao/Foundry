---
name: Social media image set
summary: A matching set of images for one message across the platforms you post on.
nature: image
settings:
  mode: simple
inputs:
  - key: brand
    label: Brand or account
    example: Ridgeline, a small outdoor gear brand
  - key: message
    label: The message
    type: textarea
    help: What the set says, in a sentence or two; the words to appear on the images, if any.
    example: The spring line is out, made to be repaired rather than replaced. On the images, only "Made to be repaired" and the launch date.
  - key: platforms
    label: Platforms
    type: choice
    options: [Instagram, X, LinkedIn, Instagram and X, all three]
    other: true
    default: all three
  - key: count
    label: How many images
    type: choice
    options: ["3", "5", "8"]
    default: "5"
  - key: style
    label: Look and feel
    type: textarea
    help: Colours, typography, photography or illustration, references.
    example: Flat illustration, slate blue and burnt orange, a heavy sans-serif for the one line of text; no photographs, no gradients.
  - key: avoid
    label: Avoid
    type: textarea
    required: false
    example: Stock-photo smiles, mountain clichés, more than one line of text per image.
---

Make a set of {{count}} social media images for {{brand}}.

## The message
{{message}}

## Platforms
{{platforms}}

## Look and feel
{{style}}

## Avoid
{{avoid}}

## Already decided
- One idea, carried across every image: same palette, type and spacing, each sized for its platform.
- Deliver each image in its platform's native size, named by platform and number.
- Nothing on the images that was not in the message above.
