---
name: A part
summary: One machined or printed part, from what it does and its key dimensions to the files you need.
nature: cad
inputs:
  - key: part
    label: The part
    help: What it is called, and what it fits.
    example: a wall bracket for a 40 mm curtain pole
  - key: function
    label: What it does
    type: textarea
    help: What it holds, guides, covers or connects, and the forces or heat it sees.
    example: Holds one end of a 40 mm pole 80 mm off the wall, screwed to the wall with two screws; carries about 5 kg of curtain with a tug now and then.
  - key: dimensions
    label: Key dimensions
    type: textarea
    help: With units. Overall size, hole positions and sizes, fits and clearances, wall thickness.
    example: |
      Pole socket 40.5 mm bore, 25 mm deep, open at the top so the pole lifts out.
      Stand-off 80 mm from the wall plate to the pole centre.
      Wall plate 60 × 40 mm with two 5 mm holes 40 mm apart, countersunk.
      Walls at least 4 mm.
  - key: material
    label: Material
    required: false
    example: PETG, or aluminium if machined
  - key: process
    label: How it will be made
    type: choice
    options: [3D printing (FDM), 3D printing (resin), CNC machining, sheet metal, not decided yet]
    default: not decided yet
  - key: exports
    label: Files needed
    type: choice
    options: [STEP, STEP and STL, STEP and 3MF, "STEP, STL and a drawing"]
    default: STEP and STL
---

Model {{part}}.

## What it does
{{function}}

## Key dimensions
{{dimensions}}

## Material
{{material}}

## How it will be made
{{process}}

## Files needed
{{exports}}

## Already decided
- A parametric model: the key dimensions are named parameters, so a change is one number.
- Geometry checks are the tests: volume, bounding box, hole positions, wall thickness, written before the model.
- Fillets and chamfers where a hand or a tool meets the part; none where they would hide a dimension.
