# ADR-0087: The HyperFrames harness — a film under the HyperFrames engine goes through the same gates, sheets, scored critique and verifier as a motion-studio film, with Foundry's scripts over the HyperFrames CLI; templates on that engine need no beta

**Status:** accepted · 2026-11-04 · builds on [ADR-0077](0077-the-motion-studio-video-engine.md) and [ADR-0086](0086-the-editor-on-video-goals.md)

## Context

Foundry has two video engines. motion-studio (ADR-0077) is Foundry's own: a film as a function of time, a renderer,
synthesised sound, a critique loop on contact sheets with a seven-axis rubric the task reviewer scores, a verifier that
measures the file, and fixed deliverables. HyperFrames (HTML + GSAP compositions rendered by the HyperFrames CLI,
Apache-2.0) had only its skills' own `lint` and `check`: no gates, no sheets, no scores, no contract on the file. The
person wanted the two engines to look the same to the reviewer and to the checks, and asked for templates that play to
HyperFrames' strengths (an on-device voice and transcription, a recording cut with captions, a slideshow).

Facts that shaped it: the reviewer's `scores` are seven fixed axes (`VERDICT_AXES`) drawn in the task drawer; the
motion-studio rubric, sheets and verifier are plain ffmpeg scripts except the loop seam and determinism, which depend
on `seek(t)`; a HyperFrames project is `video/<slug>/` with a root composition whose `data-duration` is the film's
length, and the CLI renders one composition at one size (another format is another root composition); the CLI mixes
the placed `<audio>` elements but does not normalise loudness; the Clarify and planner prompts tested
`goal.videoPack === 'motion-studio'` directly, so a goal following Settings' engine (a null pick) never saw an engine
section; every template with a `videoPack` was hidden behind the motion-studio beta, HyperFrames or not.

## Decision

- **A bundled skill, `hyperframes-harness`** (`catalog/bundled/hyperframes-harness`, in the `hyperframes` bundle, a
  worker `must` and a reviewer-task `prefer` on video): the gates in order (intake, style guide, storyboard on the
  grid, build and draft, critique rounds, sound, deliver), `scripts/scaffold.mjs` (`hyperframes init video/<slug>`
  at the project's pinned release, `lib/` copied to `video/lib/`, the review log and README, a `.gitignore` for the
  CLI's folders), `lib/sheets.mjs` (motion-studio's, engine-agnostic), `lib/loudness.mjs` (two-pass loudnorm to -14
  LUFS, video copied), `lib/verify.mjs` (H.264, yuv420p, the format's size, the duration within 0.1 s of
  `--duration` or of the root composition's `data-duration`, an audio stream, loudness ±1 LU; no loop seam, no
  determinism), `prompts/critique.md` with the same seven axes. Deliverables under `artifacts/video/<slug>/`
  (`final-<format>.mp4`, poster, contact, phone, `rounds/`), the project committed under `video/<slug>/`, the log
  and style guide under `docs/video/`.
- **Clarify and planner sections for the engine** (`HYPERFRAMES_CLARIFY`, `HYPERFRAMES_PLAN`): what the Brief settles
  (the formats' rule: the first is the film, another format is its own reframed root composition, never a crop; the
  voice and captions made on this computer; the slug), the goal-level must checks on the verifier per format, the
  five tasks with their checks (the storyboard, the first sheets as a milestone, `check --json`, three logged rounds,
  an audio stream, the delivery files), and the reviewer rubric. Live, a milestone on the storyboard task showed as
  failed evidence (a document, no picture): the first look is the first sheets. The prompts now see the engine the goal follows — `engine.videoPackOf`
  at the callers — so a goal with no pick of its own gets the section of Settings' engine; motion-studio's sections
  gain the same.
- **A doctor check, `hyperframes`**, while Settings' Video skills name the engine: Node.js 22 or newer and ffmpeg
  with ffprobe, each with its install command; no browser, the CLI fetches its own.
- **Templates on an engine other than motion-studio need no beta**: `offeredTemplates`, `formPatch`, the templates
  API and the New goal form apply a template's `videoPack` unless it is motion-studio with the beta off. Four
  templates in English and 中文: Narrated explainer, Captioned clip, Slideshow film, Product reel (HyperFrames).
- No change to goal defaults (effort, budget, timeouts) and no wait in Clarify for the tools: a HyperFrames render is
  minutes, not an hour, and the doctor says what is missing.

## Consequences

- A HyperFrames film is judged the way a motion-studio film is: the same axes, the same 8-or-more bar, a measured
  file; the drawer shows its scores.
- The worker does more per film (sheets, rounds, the loudness pass, the verifier): a 15-second film is estimated at
  four to six sessions.
- A video goal following Settings' engine now gets an engine section in Clarify and the plan it never had; for
  motion-studio this is a fix of the same gap.
- `video/lib/` is copied into the repository like `motion/lib/`, so the film renders again without Foundry.

## Alternatives considered

- **Reusing motion-studio's verifier as is**: it needs `film.json` and the seek renderer; the loop seam and
  determinism have no meaning for a timeline the CLI renders.
- **Normalising loudness in the composition**: HyperFrames mixes the placed audio but sets no target; a post-pass
  on the delivery file is exact and leaves the project's audio as authored.
- **One root composition rendered at several sizes**: a reframe is a layout decision; scaling or cropping a 16:9
  film to 9:16 is what the motion-studio contract already forbids.
- **A wait in Clarify for Node and ffmpeg** as motion-studio has: the render fails loudly and the doctor names the
  install; the wait is for an engine whose every task needs the tools from the first minute.
