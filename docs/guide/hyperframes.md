# HyperFrames films

The **HyperFrames** engine makes a video goal's film the way a web page is made: one HTML composition per scene, animated with GSAP, rendered frame by frame by the HyperFrames command line into a real video file. It is the engine the Video skills pack names by default, it needs no key and no account, and it comes with a browser editor the person can open on the film (see [Editor](./editor.md)). This page says what a HyperFrames goal needs, how Foundry runs it through a studio's gates, and what you get.

## What the goal needs on this computer

- **Node.js 22 or newer**: the command line runs on it (`brew install node` on a Mac; the Docker image carries it).
- **ffmpeg** with ffprobe: the encoder, the contact sheets, the loudness pass and the verifier use it (`brew install ffmpeg`).
- A Chrome to render with: HyperFrames fetches its own headless Chrome on the first render; nothing to install.

The doctor on the Setup page checks Node.js and ffmpeg while the Video skills pack of Settings is HyperFrames. The skills themselves come from the Extensions catalog: the four from HyperFrames (the authoring guide, the command line, the registry of blocks, media), Foundry's own **hyperframes-harness**, the Herk Edit Kit playbooks for showreels, Shorts and long-form beats, and **brag**, Latent Spaces' launch-video skill (see below).

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

## A launch video of the repository itself, with /brag

[/brag](https://latent-spaces.github.io/brag/) is a skill that turns the project it is run in into a 15–25 second launch video: it reads the code, finds the hook, the reveal, two or three highlights and the punchline in the project's own words, picks a tone, a track and sound effects, and hands a composition brief to HyperFrames. It is in the Extensions catalog's HyperFrames bundle, pinned to one release, so **Install** on the bundle brings it along.

The **Launch video (/brag)** template starts such a goal on the repository you want to show off: what it is in a line, the tone (one of /brag's seven presets — default, polished, yc-parody, chaotic, deadpan, cinematic, app-store — or your own direction in a few words), the format (landscape, vertical or square), the length, narration or none, the music (one of /brag's bundled tracks, your own, or none), what to point at, and where you will post it. The goal runs /brag's full edition under the harness above: /brag tells the story, the harness judges it and hands it in. The project is `video/<slug>/` as for any HyperFrames film (so the Editor and Re-render find it), with /brag's `brag-plan.md`, `composition-brief.md` and `share-copy.txt` beside the composition; the film is `artifacts/video/<slug>/final-<format>.mp4` at -14 LUFS, with /brag's chosen poster as its first frame (the composition's own, so a Re-render keeps it), so every platform's thumbnail shows it. The share copy is one to three sentences, ready to post; when the film uses one of /brag's bundled tracks (Sascha Ende's, CC BY 4.0), the credit line the licence asks for stands under it, so copy both.

## Templates

Five built-in [templates](./templates.md) start a HyperFrames goal with the right settings: **Narrated explainer** (a voice made on this computer, captions, a beat), **Captioned clip** (a recording you attach, cut with captions and a hook), **Slideshow film** (your pictures, one per beat, a line on each), **Product reel (HyperFrames)** and **Launch video (/brag)**.
