---
name: An assembly
summary: Several parts that fit and move together, each modelled, then assembled and exported.
nature: cad
inputs:
  - key: assembly
    label: The assembly
    help: What it is, in a line.
    example: a desktop phone stand with an adjustable angle
  - key: parts
    label: The parts
    type: textarea
    help: Each part and how it joins the others, one per line, with the key dimensions you know.
    example: |
      Base: 120 × 90 mm plate, 8 mm thick, rubber feet in four 10 mm recesses.
      Back plate: 100 × 140 mm, hinged to the base along the back edge with a 6 mm pin.
      Lip: 12 mm tall, 80 mm wide, at the front of the back plate, with a 14 mm cable slot.
      Strut: props the back plate at 55°, 65° or 75°, resting in three notches in the base.
  - key: motion
    label: What moves
    type: textarea
    required: false
    help: Which parts move, how far, around or along what.
    example: The back plate turns on the hinge pin from flat to 80°; the strut folds flat against it for carrying.
  - key: envelope
    label: Overall size
    help: The space it must fit in, with units.
    example: Folded, no more than 120 × 90 × 25 mm.
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
