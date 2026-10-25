---
name: Poster
summary: One poster for an event, a product or a message, in the size and style you name.
nature: image
settings:
  mode: simple
inputs:
  - key: subject
    label: What the poster is for
    help: The event, product or message, in a line.
  - key: size
    label: Size
    type: choice
    options: [A4 portrait, A3 portrait, 1080 by 1350 (social portrait), 1920 by 1080 (screen)]
    other: true
    default: A4 portrait
  - key: style
    label: Look and feel
    type: textarea
    help: Mood, era, references, what it must never look like.
  - key: words
    label: Words that must appear
    type: textarea
    required: false
    help: Title, date, place, call to action, exactly as they should read.
  - key: colours
    label: Colours
    required: false
    help: Brand colours or a palette, as names or hex codes.
---

Design a poster for {{subject}}.

## Size
{{size}}

## Look and feel
{{style}}

## Words that must appear
{{words}}

## Colours
{{colours}}

## Already decided
- Deliver the poster as a print-ready file at the size above and a screen-size preview.
- Any words on it are spelled exactly as given; the text is legible from across a room.
- Show two or three directions first, then finish the chosen one.
