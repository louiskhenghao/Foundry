---
name: An assembly
summary: Several parts that fit and move together, each modelled, then assembled and exported.
nature: cad
inputs:
  - key: assembly
    label: The assembly
    help: What it is, in a line.
  - key: parts
    label: The parts
    type: textarea
    help: Each part and how it joins the others, one per line, with the key dimensions you know.
  - key: motion
    label: What moves
    type: textarea
    required: false
    help: Which parts move, how far, around or along what.
  - key: envelope
    label: Overall size
    help: The space it must fit in, with units.
  - key: exports
    label: Files needed
    type: choice
    options: [STEP of the assembly, STEP of the assembly and each part, STEP and STL of each part, "STEP, STL and drawings of each part"]
    default: STEP of the assembly and each part
---

Model {{assembly}} as an assembly.

## The parts
{{parts}}

## What moves
{{motion}}

## Overall size
{{envelope}}

## Files needed
{{exports}}

## Already decided
- One part per task, then the assembly; shared dimensions are parameters every part reads.
- Geometry checks are the tests: each part's size and holes, and the assembly's clearances and travel.
- Fasteners and standard parts come from a library, never remodelled.
