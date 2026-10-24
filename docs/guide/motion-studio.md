# Motion studio

*Beta: switch it on under [Settings → Beta](./settings.md#beta).* A second way to make a video goal: instead of a video skills pack alone, the goal follows the **motion-studio** engine, a small studio harness that Foundry ships and the worker never has to rebuild: a renderer that paints any moment of the film on demand, a critique loop that makes the worker look at its own frames before it hands anything in, a fixed set of deliverables, and checks that measure them.

## Choosing the engine

With the Beta switch on, a video goal on the New goal form shows an **Engine** picker under *Kind of goal*. Leave it on the pack Settings names, or pick **motion-studio**. The choice is frozen when the goal is created, like the workflow suite; the goal's sessions build their prompts with it, and the Extensions catalog, the doctor and the Video skills pack of Settings stay as they are for every other goal.

A motion-studio goal starts with what a film needs: **xhigh** effort unless Settings or the form say otherwise, the **Thorough** budget, an hour per session (see [Sessions that run long](#sessions-that-run-long)) and milestones that notify without pausing.

## What the goal needs on this computer

The engine renders through a headless Chromium and encodes with ffmpeg. Foundry drives the Chromium it already ships for its own self-check; **ffmpeg** has to be on the computer (`brew install ffmpeg` on a Mac; the Docker image carries it). The doctor on the Setup page checks both when the Beta switch is on, and a motion-studio goal waits in Clarify until they are there, the way a CAD goal waits for its tools; the install on the Setup page lets it go on.

## How a film is made

The Clarifier settles what a film needs before anything renders: the subject or product and its URL, the duration, the formats (16:9, 9:16, 1:1, 4:5 — every one from the same timeline, never a crop), the brand colours and faces or a style direction you pick from cards, the reference you attached (a frame, a clip, a folder of pictures), the music (a track you attach, or one synthesised on the film's beat), the language of the words on screen and the closing line. Attach a reference clip or a track to the goal: audio and video files may weigh up to 200 MB.

The plan then runs through the gates of a studio:

1. **Style guide and shotlist** — the real assets gathered, a style guide written from the reference, the shots laid on a beat grid. The task is a milestone: the shotlist is shown on the goal page and the goal goes on.
2. **Stills and animatic** — every shot still, then moving at a low frame rate, with a contact sheet each round.
3. **Full pass** — springs everywhere, motion blur, the held-back colour at the climax; at least three critique rounds, each scored and logged.
4. **Sound** — a score synthesised on the beat (or your track measured for its grid), effects on the cues, mixed to the loudness the platforms expect.
5. **Render and verify** — every format, the loop check, the poster and the contact sheet; the verifier measures the file.
6. **House style** — what the next film for this product starts from.

Each task is judged twice: the worker critiques its own contact sheets by a fixed rubric, then the task reviewer opens the sheets and **scores seven axes** 1–10 (hook, readability, motion, variety, composition, brand, sound); the task lands only when every axis is 8 or more. The scores show in the task drawer, with the move since the attempt before.

## What you get

Under the goal's artifacts, per format: `final-<format>.mp4` (H.264, 1080 wide or tall, the duration you asked for, -14 LUFS), `loop_check.mp4`, `poster.png` and `contact.png`; the artifacts strip plays the film with its poster. In the repository: the film's source under `motion/<slug>/` with a README that renders it again, and under `docs/motion/` the style guide, the review log with every round's scores, and the house style. When the goal completes, the house style is also written as a project skill (`motion-house-style`) that your own coding sessions read, kept out of git like the Learnings skill.

## Sessions that run long

A film is built and rendered in sessions longer than a code change: every goal can now carry its own **Attempt timeout** (Custom budget on the New goal form, 5 to 240 minutes), which caps one session of that goal; blank keeps [Settings → Models & limits](./settings.md#models--limits). A motion-studio goal is created with 60 minutes.

## Where the idea comes from

The harness follows the pattern the motion-design community worked out after Opus 5.5 shipped — a film as a function of time, closed-form springs, a beat grid, synthesised sound, and a model made to look at its own frames — as Movez laid it out in [*How to build motion design studio with Opus 5.5*](https://x.com/0xMovez/status/2104216919033192746). The scripts and prompts are Foundry's own.
