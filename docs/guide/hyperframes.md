# HyperFrames films

The **HyperFrames** engine makes a video goal's film the way a web page is made: one HTML composition per scene, animated with GSAP, rendered frame by frame by the HyperFrames command line into a real video file. It is the engine the Video skills pack names by default, it needs no key and no account, and it comes with a browser editor the person can open on the film (see [Editor](./editor.md)). This page says what a HyperFrames goal needs, how Foundry runs it through a studio's gates, and what you get.

## What the goal needs on this computer

- **Node.js 22 or newer**: the command line runs on it (`brew install node` on a Mac; the Docker image carries it).
- **ffmpeg** with ffprobe: the encoder, the contact sheets, the loudness pass and the verifier use it (`brew install ffmpeg`).
- A Chrome to render with: HyperFrames fetches its own headless Chrome on the first render; nothing to install.

The doctor on the Setup page checks Node.js and ffmpeg while the Video skills pack of Settings is HyperFrames. The skills themselves come from the Extensions catalog: the four from HyperFrames (the authoring guide, the command line, the registry of blocks, media), Foundry's own **hyperframes-harness**, and the Herk Edit Kit playbooks for showreels, Shorts and long-form beats.

## How a film is made

The Clarifier settles what a film needs before anything renders: the subject or product and its URL, the duration, the formats (16:9, 9:16, 1:1, 4:5 — the first is the film; every other format is its own composition reframed by hand, never a crop), the brand colours and faces or a style direction you pick from cards, the reference you attached, the music (a track you attach, or one of the bundled ones), the voice (none, or narration made on this computer), the language of the words on screen and the closing line. Audio and video attachments may weigh up to 200 MB.

The plan then runs through the harness's gates:

1. **Style guide and storyboard** — the real assets gathered, a style guide written from the reference, the shots laid on a beat grid; the project is laid out under `video/<slug>/`.
2. **Build and draft** — one scene per sub-composition mounted by the root, the command line's check clean, a draft render and the first contact sheets. The task is a milestone: the sheets are shown on the goal page and the goal goes on.
3. **Critique rounds** — the worker scores its own sheets by a fixed rubric, fixes the three worst problems, re-renders only the span it touched; three rounds at least, each logged with its scores.
4. **Sound** — the music placed, effects on the cuts, the voice from the on-device text-to-speech and the captions from the on-device transcription when the Brief asks.
5. **Deliver** — every format at delivery quality, brought to -14 LUFS, with its contact sheet, phone sheet and poster; the verifier measures each file.

Each task is judged twice: the worker critiques its own contact sheets, then the task reviewer opens the sheets and **scores seven axes** 1–10 (hook, readability, motion, variety, composition, brand, sound); the task lands only when every axis is 8 or more. The scores show in the task drawer, with the move since the attempt before, as for a motion-studio film.

While the goal runs, and after, the **Editor** row on its page opens HyperFrames' browser editor on the project; once the goal has finished, **Re-render** makes the films again after your edits. See [Editor](./editor.md).

## What you get

Under the goal's artifacts, per format: `final-<format>.mp4` (H.264, 1080 wide or tall, the duration you asked for, -14 LUFS), `poster.png`, `contact.png` and `phone.png`, and under `rounds/` the sheets of every critique round; the artifacts strip plays the film with its poster. In the repository: the project under `video/<slug>/`, committed, with a README that renders it again, and under `docs/video/` the style guide and the review log with every round's scores. The command line's own folders (`renders/`, `.hyperframes/`, `.thumbnails/`) stay out of git.

## Templates

Four built-in [templates](./templates.md) start a HyperFrames goal with the right settings: **Narrated explainer** (a voice made on this computer, captions, a beat), **Captioned clip** (a recording you attach, cut with captions and a hook), **Slideshow film** (your pictures, one per beat, a line on each) and **Product reel (HyperFrames)**.
