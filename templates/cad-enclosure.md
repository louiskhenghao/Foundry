---
name: Enclosure for a circuit board
summary: A printable enclosure for a board — standoffs, port cutouts, a lid that snaps or screws, vents and a wall mount — designed for the printer and checked by geometry.
nature: cad
settings:
  budgetPreset: thorough
inputs:
  - key: board
    label: The board
    help: Its name and its outline with units; attach a STEP or a drawing below if you have one.
    example: a 65 × 56 mm single-board computer, 1.6 mm thick, with four 2.75 mm mounting holes at 58 × 49 mm
  - key: ports
    label: Ports and openings
    type: textarea
    help: Each connector or light that must reach the outside, with its position on the board edge and its size.
    example: |
      Two USB-A and one Ethernet on the long edge, 15 mm tall from the board.
      USB-C power and a micro HDMI on the short edge.
      A status LED near the corner — a light pipe or a 2 mm hole.
      A 40-pin header that stays reachable under the lid.
  - key: lid
    label: The lid
    type: choice
    options: [snap fit, four screws into heat-set inserts, sliding lid]
    default: snap fit
  - key: mounting
    label: How it is mounted
    type: choice
    options: [sits on a desk on rubber feet, screws to a wall or a DIN rail, both]
    default: sits on a desk on rubber feet
  - key: cooling
    label: Cooling
    type: choice
    options: [passive vents, room for a 30 mm fan, no vents needed]
    default: passive vents
  - key: process
    label: How it will be made
    type: choice
    options: [3D printing (FDM), 3D printing (resin), CNC machining]
    default: 3D printing (FDM)
  - key: exports
    label: Files needed
    type: choice
    options: [STEP and STL of each part, STEP and 3MF of each part, "STEP, STL and a drawing of each part"]
    default: STEP and STL of each part
---

Model an enclosure for {{board}}.

## Ports and openings
{{ports}}

## The lid
{{lid}}

## How it is mounted
{{mounting}}

## Cooling
{{cooling}}

## How it will be made
{{process}}

## Files needed
{{exports}}

## Already decided
- A parametric model whose parameters are the board outline, hole pattern, board thickness, wall thickness and clearance; a different board is a change of numbers.
- Walls at least 2 mm, standoffs sized for M2.5 screws or heat-set inserts with the board held 3 mm clear of the floor; a 0.3 mm clearance around every port cutout plus the connector's own tolerance.
- Designed for the process above: no overhang past 45° without a chamfer or a bridge the printer can make, snap fits sized for the material's flex, the parts oriented to print without supports and the orientation stated.
- Geometry checks are the tests: the board fits with clearance, every port lines up with its cutout, the lid closes, nothing collides; they run before the model is accepted.
- Vents follow the airflow (in low, out high) and keep fingers out; a drawing shows the overall size and where the screws go.
