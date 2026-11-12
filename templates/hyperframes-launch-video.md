---
name: Launch video (/brag)
summary: A 15–25 second launch video of this very repository, made with /brag — the hook, the reveal, two or three highlights and a punchline in the project's own words, with music, sound effects and the share copy to post it with.
nature: video
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: project
    label: What it is
    help: The project in this repository, in a line; /brag finds the rest in the code.
    example: Ledgerly, invoicing for freelancers that chases late payers for you
  - key: tone
    label: Tone
    type: choice
    options: [default, polished, yc-parody, chaotic, deadpan, cinematic, app-store]
    other: true
    default: default
    help: A preset, or your own direction in a few words (a fake Series A launch from 2016, a museum exhibit, an overproduced mobile game ad).
  - key: format
    label: Format
    type: choice
    options: ["landscape (16:9)", "vertical (9:16)", "square (1:1)"]
    default: landscape (16:9)
  - key: duration
    label: Length
    type: choice
    options: [about 15 s, about 20 s, about 25 s]
    default: about 20 s
  - key: voice
    label: Narration
    type: choice
    options: [none, narration made on this computer]
    default: none
  - key: music
    label: Music
    type: choice
    options: ["one of /brag's bundled tracks", "my own track (attached below)", none]
    default: "one of /brag's bundled tracks"
  - key: focus
    label: Point at
    type: textarea
    required: false
    help: A release, one feature, one angle the video should be about; empty means the whole project.
    example: The reminder schedule that shipped last week, and the "paid" confetti.
  - key: post
    label: Where it will be posted
    required: false
    help: Shapes the share copy.
    example: X and LinkedIn
---

With /brag, make a launch video of this repository, {{duration}} long: {{project}}.

## Tone
{{tone}}

## Format
{{format}}

## Narration
{{voice}}

## Music
{{music}}

## Point at
{{focus}}

## Where it will be posted
{{post}}

## Already decided
- The story is /brag's, run with `--full` (never the slim edition): it reads the code, writes `brag-plan.md`, `composition-brief.md` and `share-copy.txt`, and hands the composition to HyperFrames. Every claim on screen is one the project makes itself; nothing invented, no secret, key, hostname or real customer in the frame.
- Its output folder is the HyperFrames project `video/<slug>/` itself (no `composition/` inside), so the Editor and Re-render find it. Its `brag.mp4` is `artifacts/video/<slug>/final-<format>.mp4`, brought to -14 LUFS, with /brag's best frame as frame 0 (the composition's own first frame, so a Re-render keeps it) and kept as `poster.png`; `share-copy.txt` stays in the project folder, with the credit line a bundled track's licence asks for under it.
- Foundry's harness still judges it: contact sheets, three critique rounds, the reviewer's seven axes at 8 or more, the verifier on the delivered file.
