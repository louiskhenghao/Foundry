---
name: Slideshow film
summary: Photos or screens you attach, as a film — one per beat, a line of words on each, music under it.
nature: video
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: pictures
    label: The pictures
    help: Attach them to the goal below (photos, screenshots, renders). Say here what they are and the order, if it matters.
    example: Twelve photos of the new studio, in the order of a walk from the door to the window.
  - key: story
    label: What it is about
    type: textarea
    help: The line of the film, and the words to put on screen if you have them.
    example: Our studio moved. Door, desks, the big table, the window at five o'clock.
  - key: duration
    label: Length
    type: choice
    options: [15 s, 30 s, 45 s, 60 s]
    default: 30 s
  - key: formats
    label: Formats
    type: choice
    options: ["16:9", "9:16", "1:1", "16:9 and 9:16"]
    default: 16:9
  - key: music
    label: Music
    type: choice
    options: [a bundled track, my own track (attached below), none]
    default: a bundled track
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, fonts, logo; attach files below if you have them.
    example: Warm grey and a single orange; a serif for the words.
---

Make a {{duration}} slideshow film from the attached pictures.

## The pictures
{{pictures}}

## What it is about
{{story}}

## Formats
{{formats}}

## Music
{{music}}

## Brand
{{brand}}

## Already decided
- One picture per beat, each with a slow move of its own (a push in, a drift) and a cut on the grid; never a crossfade between every pair.
- A line of words at most per picture, inside the title-safe box, held long enough to read.
- Every picture fills its frame as it was shot; a portrait picture on a landscape film sits on a blurred copy of itself, never stretched.
