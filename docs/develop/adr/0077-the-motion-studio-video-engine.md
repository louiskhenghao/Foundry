# ADR-0077: The motion-studio video engine — a goal picks its video engine, Foundry ships the harness, the reviewer scores the frames

**Status:** accepted · 2026-10-25 · a Beta feature (Settings → Beta); builds on [ADR-0005](0005-scenario-skills-and-settings.md) (packs), [ADR-0008](0008-non-code-goals.md) (media goals, `artifacts/`), [ADR-0049](0049-workflow-suites.md) (a per-goal choice frozen at creation) and [ADR-0074](0074-a-goal-asks-for-what-only-the-person-can-give.md) (a Request has no timeout)

## Context

A video goal has one lever: the **Video skills pack** chosen in Settings (web-video-presentation, mmx-cli, hyperframes). The
pack's skills are mandated to the worker and the rest is the worker's problem: it scaffolds a pipeline in the workspace,
renders, hands in an MP4, and a reviewer that cannot watch video checks the file with ffprobe. The result depends on what
the model reaches for by default, and the default of every model is the same film: centred text on a gradient, everything
fading in, a logo at the end.

The motion-design work people shared after Opus 5.5 shipped showed where the difference lies. The prompt is a tenth of it;
the other nine tenths are a harness: a renderer that is a pure function of time (`seek(t)` paints frame *t*, a headless
browser screenshots each frame, ffmpeg stitches), closed-form springs instead of easing curves, a beat grid the cuts land
on, sound synthesised on the same timeline, a critique loop in which the model renders contact sheets and scores its own
frames until every axis is good enough, a director's brief with gates, a fixed set of deliverables. None of that is a
prompt; all of it is what Foundry is for.

Three facts of the engine shaped the design. The pack is one global Settings choice, so two engines could not be used side
by side. Every catalog skill comes from somewhere else (a git repository, a plugin, a suite, a tool on PATH), so a skill
whose scripts must match the engine's own checks had nowhere to live. And a task worktree has no `node_modules`, while a
session is cut after twenty minutes and five silent minutes, which no film render survives unprepared.

## Decision

1. **The engine is a per-goal choice.** A video goal carries `videoPack` (null = the Settings pack), frozen at creation like
   the workflow suite; every role's prompt is built with `engine.packsFor(goal)`, so only that goal's sessions see the
   other engine's skills. The pack enums move to `packs.ts`, read by the settings and the goal schema alike.
2. **Foundry ships the harness as a bundled skill.** The catalog gains `source: { type: 'bundled', path }`: a folder under
   `catalog/bundled/` of the Foundry that runs, copied into the skills folder on install, its marker naming `foundry` and
   the folder's content fingerprint, grouped on the Updates page as *Bundled with Foundry*, outdated when a newer Foundry
   ships a different folder, never credited as a third-party project. The motion-studio skill carries the renderer
   (`render.mjs`, Playwright frames piped to ffmpeg, progress printed every second so the idle cut never fires), the
   springs (`motion.js`), the sound and beat scripts (Node only: ffmpeg to PCM, an energy envelope, BPM and onsets — an
   approximation, said so in the docs), the verifier (`verify.mjs`) and the rules, all written for Foundry; the article
   that showed the pattern is credited in the guide, its templates are not copied.
3. **The engine's own Playwright serves the render.** Every session gets `FOUNDRY_PLAYWRIGHT`, the package directory the
   engine imports, as the self-check and the QA session already use it; the render script tries `import('playwright')`
   and falls back to it. The worker installs nothing.
4. **A goal can cap its own sessions.** `Budgets.attemptTimeoutMin` (5–240, null = Settings) replaces the global twenty
   minutes for one goal; a motion-studio goal is created with 60.
5. **The gates are Brief checks, as everywhere else.** The pace stays *fast*; the Clarifier of a motion-studio goal gives
   every task a reviewer check (the rubric) and command checks (`verify.mjs`: duration, resolution, yuv420p, loudness,
   two renders of a 5-second sample hashing the same, the loop seam). The worker critiques its own contact sheets at
   least three rounds; the task reviewer then scores contact, strip and phone sheets on seven axes (hook, readability,
   motion, variety, composition, brand, sound), 1–10, all 8 or more to pass; the verdict carries `scores`, drawn on the
   task card. Style guide and shotlist are a milestone that notifies and never waits ([ADR-0074](0074-a-goal-asks-for-what-only-the-person-can-give.md)'s bound stands).
6. **A fixed contract.** The Clarifier collects subject or product and URL, duration, formats (always asked), brand
   colours and fonts, a reference, music (a file or "synthesise"), language, CTA and engine; references come as goal
   attachments. The deliverables, per format: `final.mp4`, `loop_check.mp4`, `poster.png`, `contact.png`, a README and
   the clean source under `motion/<film>/`, frames and outputs under `artifacts/motion/<film>/`. The last task writes
   `docs/motion/house-style.md`, which the Learnings export copies beside the notebook as a project skill.
7. **Behind a Beta switch.** `beta.motionStudio` hides the engine picker, the catalog entry, the doctor's ffmpeg and
   Chromium checks and the house-style task; what the work improves for every goal — audio and video attachments up to
   200 MB, HTTP Range on file routes, inline playback with a poster, `scores` on a verdict, ffmpeg in the Docker image —
   ships regardless.
8. **Out of v1.** Video models and text-to-speech (keys and billing), a timeout on Requests, per-role effort on Claude
   (the whole goal runs at xhigh), packaging a goal's pipeline into a skill of its own.

## Consequences

- Two video routes with one contract: the HyperFrames pack and the motion-studio engine share the Clarify checklist,
  the deliverables and the critique gate; web-video-presentation and mmx-cli are untouched.
- Old goal rows read back with `videoPack: null` and `attemptTimeoutMin: null` (normalizeGoal); every fixture carries
  both fields.
- A bundled skill is versioned with Foundry: a release that changes `catalog/bundled/` shows an update on the Updates
  page, nothing fetches from GitHub for it, and the credits list skips it.
- The Docker image grows by ffmpeg; Chromium keeps its volume.
- The design is built in blocks on one branch (platform, media, skill and flow), merged as one.

## Alternatives considered

- **Switch the Settings pack between goals.** Fails the moment two video goals run, and hides the choice from the goal's
  record.
- **A separate repository for the skill, installed from GitHub like the others.** Keeps the catalog mechanism untouched,
  but the skill's scripts and the engine's checks would release on two clocks; a bundled folder moves with the engine.
- **The worker installs Playwright in each worktree.** Minutes per task, hundreds of megabytes per worktree, and a render
  that depends on whatever version npm serves that day.
- **A Request with a timeout for the shotlist.** Contradicts ADR-0074 for one use; the milestone that notifies and goes on
  gives the person the same look without a wait.
- **The old route through HyperFrames only, with a better prompt.** The prompt is the tenth; the harness is the rest.
