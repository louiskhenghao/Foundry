# ADR-0089: A launch video of the repository itself is told by /brag and judged by the HyperFrames harness — the skill joins the HyperFrames bundle at one release, its output folder is the harness's project folder, and a template starts such a goal

**Status:** accepted · 2026-11-10 · builds on [ADR-0087](0087-the-hyperframes-harness.md) and [ADR-0049](0049-workflow-suites.md)

## Context

The person asked for [/brag](https://github.com/latent-spaces/brag) in Foundry: an MIT agent skill by Latent Spaces
(0.5.0, October 2026) that turns the project it runs in into a 15–25 second launch video. It reads the code, answers a
nine-question rubric, commits to an angle, writes a storyboard (`brag-plan.md`) and a composition brief, hands the
build to HyperFrames, renders, picks the best settled frame as the poster and bakes it in as frame 0, and writes
one to three sentences of share copy. It bundles five tracks (Sascha Ende, CC BY 4.0, which asks for a credit line),
Kenney sound effects (CC0), beat-cue presets for the tracks and a sound-effect analysis; seven tone presets; an
optional narration through HyperFrames' on-device voice. Its slim edition builds the whole video itself with
"whatever tools are on the machine", asking before installing anything, and the full skill switches to it on its own
when the model is Claude Opus 5.5 unless told `--full`.

Foundry already has the HyperFrames engine under its harness (ADR-0087): a project at `video/<slug>/` the Editor
finds by its `hyperframes.json` and Re-render renders again, contact sheets, three logged critique rounds scored on
seven axes by the task reviewer, a loudness pass to -14 LUFS and a verifier on `artifacts/video/<slug>/final-<format>.mp4`.
/brag's own conventions differ on every point that is a path: `brag-output/` (timestamped when it exists) holding
the plan, the brief, `composition/` as the HyperFrames project, `brag.mp4` and `brag.jpg`; its single gate is
`hyperframes check`; it waits at the preview for the person; it renders where it is run.

## Decision

- **/brag is a catalog entry of the `hyperframes` bundle** (`brag`, source `latent-spaces/brag` at the commit of its
  0.5.0 release, path `skills/brag`; the slim edition is not installed), a worker `prefer` on video — never a `must`:
  the harness stays the judge and the only must beside the `hyperframes` skill. Its rule says when it applies (a
  launch video of the repository itself: the template, or a prompt that names /brag), `--full` always, and the path
  mapping below. It is credited on the Open source credits page as MIT with a note on its music and sound effects.
- **/brag's output folder is the harness's project folder.** `video/<slug>/` is at once the HyperFrames project and
  /brag's `<output-dir>`: `brag-plan.md`, `composition-brief.md` and `share-copy.txt` sit beside the composition, no
  `composition/` inside; `brag.mp4` is `artifacts/video/<slug>/final-<format>.mp4` after the loudness pass; the
  poster /brag picks is frame 0 of that file as the composition's own first frame (never an overlay added after the
  render, which a Re-render would lose) and kept as `poster.png`. Everything the Editor, Re-render and the verifier expect stays
  where it was.
- **/brag owns the story; the harness owns the judging and the delivery.** /brag's inspect and plan replace the
  harness's style guide and storyboard task (the style guide is written from the brief's visual identity, so nothing
  is invented twice); its hand-off to HyperFrames is the build task; the critique rounds, the sound task, the
  loudness pass, the sheets and the verifier stand; `share-copy.txt` is a must check beside the films; when a bundled
  track is used, the credit line its licence asks for stands under the share copy. The worker never waits at
  /brag's preview: Foundry opens the editor itself (ADR-0086).
- **The Clarify and planner sections for the engine say so** (one paragraph each in `HYPERFRAMES_CLARIFY` and
  `HYPERFRAMES_PLAN`, read by every HyperFrames goal): what the Brief settles for a launch video (tone as a preset
  or the person's words, one format, the length, narration, the music; the slug `launch` by default) and how the
  five tasks differ (what task 1's check tests instead of `STORYBOARD.md`, what task 5 adds).
- **A template, `Launch video (/brag)`**, in English and 中文, on the HyperFrames engine: what it is, tone (the seven
  presets, or a direction of one's own), format, length, narration, music, what to point at, where it will be posted;
  its "Already decided" section carries the path mapping and the rules above into the goal description, so a goal
  made from it needs no engine knowledge of the template.

## Consequences

- A person makes a launch video of any repository by starting a goal on it from the template; the result opens in
  the Editor and renders again after their edits like any HyperFrames film, and its scores show in the task drawer.
- The skill is installed with the HyperFrames bundle (a shallow clone of its repository, about 16 MB of skill with
  its music and effects) and updated like any catalog entry when Foundry moves the pin; a Foundry release reviews
  the skill's workflow text against the harness's paragraph when it does.
- The prompt of every HyperFrames goal is a paragraph longer in Clarify and in the plan, whether or not it is a
  launch video.
- Two words for one thing remain in the worker's session (/brag's `brag.mp4` and the harness's `final-<format>.mp4`);
  the mapping is stated in three places that agree (the catalog rule, the engine sections, the template), and the
  checks test the harness's names.

## Alternatives considered

- **Keeping /brag's own layout** (`brag-output/composition/`, `brag.mp4`): the Editor finds the project (four levels
  down), but Re-render names the artifacts folder after the project folder (`composition`), the verifier's and the
  Clarify checks name `video/<slug>/`, and the renders would be committed where the skill leaves them; every
  consumer would have needed a second convention.
- **A `brag` video engine of its own** (`videoPack: brag`): an engine is a renderer with a harness; /brag is a story
  on top of the HyperFrames one. A pack would have hidden the HyperFrames skills, which /brag needs.
- **Making /brag a worker `must` on video**: it applies to launch videos only; a product reel or an explainer is not a
  brag, and the harness test keeps the must set to the two skills that judge.
- **Installing the slim edition too**: it skips HyperFrames (so the Editor, Re-render and the verifier have nothing),
  asks before installing tools, and takes over on its own on one model; `--full` in every rule keeps the one path.
- **A keyword test in the engine** (`/brag` in the description) to switch the sections on: the paragraphs are short,
  and a goal that is not a launch video reads them as the conditional they are.
