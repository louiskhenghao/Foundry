---
name: 3D product showcase website
summary: A website built around an interactive 3D model of a product — a car, a bike, a device — that the visitor turns, configures and scrolls through, at 60 fps on a phone.
nature: code
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: The product
    help: What the site shows, in a line.
    example: the Vela S, a two-seat electric roadster
  - key: model_source
    label: The 3D model
    type: choice
    options: [I will attach a glTF or GLB model, build a stylised model in code from reference photos, find a freely licensed model and adapt it]
    other: true
    default: I will attach a glTF or GLB model
  - key: sections
    label: The sections of the site
    type: textarea
    help: Top to bottom, what each section says and shows; where the 3D model appears and what the camera does there.
    example: |
      Hero: the car on a dark turntable, the name and one line; drag to turn, scroll to begin.
      Design: the camera glides along the body as three short paragraphs appear; hotspots on the headlights, the door handles and the wheels open a note each.
      Configurator: paint, wheels and interior; the model updates in place; a price line follows.
      Performance: numbers that count up; a diagram of the drivetrain drawn as the section enters.
      Footer: a test-drive form and the legal lines.
  - key: variants
    label: Variants to configure
    type: textarea
    required: false
    help: Colours, trims, options; their names as the site should show them.
    example: Paint — Glacier, Ink, Ember, Moss. Wheels — 19" aero, 20" forged. Interior — slate, oat.
  - key: interactions
    label: What the visitor can do with the model
    type: textarea
    help: Turn, zoom, open doors, switch lights, change variants; on a phone as well as a mouse.
    example: Drag or swipe to turn, pinch or wheel to zoom within limits, tap a hotspot for a note, tap the door handle to open the door, the headlights come on at the Performance section.
  - key: stack
    label: Stack
    type: choice
    options: [whatever the repository already uses, Next.js with React Three Fiber, Vite with plain Three.js, Astro with a Three.js island]
    default: whatever the repository already uses
  - key: devices
    label: Must run well on
    type: choice
    options: [a mid-range phone and a laptop, a laptop or desktop only]
    default: a mid-range phone and a laptop
  - key: brand
    label: Brand
    type: textarea
    required: false
    help: Colours, type, tone of voice; attach a logo or a style guide below if you have one.
    example: Deep graphite and off-white, one accent in signal orange; headlines in a wide grotesque; copy short and confident, never shouting.
---

# {{product}}: a 3D showcase website

## The 3D model
{{model_source}}

## The sections
{{sections}}

## Variants to configure
{{variants}}

## What the visitor can do with the model
{{interactions}}

## Stack
{{stack}}

## Must run well on
{{devices}}

## Brand
{{brand}}

## Already decided
- The model ships as glTF with Draco or Meshopt compression, lazy-loaded after the first paint, with a baked environment map and no runtime shadow maps beyond one contact shadow; textures sized for the device.
- A frame budget of 16 ms on the target devices: the model's triangle count, draw calls and texture memory are measured and stated in the README, with the levels of detail used.
- Scroll drives the camera through a timeline (no scroll hijacking: the page scrolls as a page); `prefers-reduced-motion` turns camera moves into cuts.
- Every 3D section has a static fallback image for devices without WebGL and for the first paint; all copy and hotspot notes are real HTML, readable by a screen reader and indexable.
- Lighthouse performance ≥ 90 on a mid-range phone profile, accessibility ≥ 95; the configurator state lives in the URL so a configured car can be shared.
- Variants switch materials and meshes in place without reloading the model; the price line and the summary follow from one source of truth.
- Playwright tests cover the configurator and the hotspots; the milestone script turns the model and switches a variant on camera.
