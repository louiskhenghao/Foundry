---
name: hyperframes-harness
description: Make a HyperFrames film under Foundry's quality harness — the gates a studio runs a film through, contact sheets and a critique rubric the film is scored on, the loudness pass and the verifier that measures the delivered file. Use on every video goal whose engine is HyperFrames, with the hyperframes and hyperframes-cli skills for the authoring itself.
---

# HyperFrames films under Foundry's harness

The `hyperframes` skill says how a film is written; this one says how it is judged and handed in. A film lives in a project of its own, `video/<slug>/` (the folder `hyperframes init` makes), its renders and sheets under `artifacts/video/<slug>/`, its log under `docs/video/`. Node 22+ and FFmpeg are on the computer; HyperFrames fetches the Chrome it renders with. Run every command from the repository root. Never stop at the preview to wait for the person: Foundry opens the browser editor for them itself. Never `cloud`, `lambda` or `cloudrun`; never sign in to HeyGen; the free local tools only (`/media-use`: bundled sound effects, `tts` on device, `transcribe` on device).

## The gates, in order

1. **Intake.** Read the Brief: subject or product and its URL, duration, formats, brand colours and faces, the reference (goal attachments), the music and the voice, the language, the CTA. Gather real assets: the real screens (`npx hyperframes capture <url>` or screenshots), the real logo, the real colours. Never redraw a product's UI from memory.
2. **Style guide.** With a reference: frames every half second (`ffmpeg -i ref.mp4 -vf fps=2 refs/%03d.png`), look at them, write `docs/video/style_guide.md`: palette (hex), type, shot lengths, transition kinds, how text enters and leaves. Take the grammar of the reference, never its content, logos or characters.
3. **Storyboard on the grid.** `node <skill>/scripts/scaffold.mjs <slug> --title "…"` lays the project out. Write `video/<slug>/STORYBOARD.md`: BPM and beat length (`npx hyperframes beats` on a supplied track), one row per shot with its seconds, what is on screen, the sound. A visual payoff every 3–5 seconds, something new every 2–4, a hook inside the first 2. This task is a milestone: it shows the storyboard and goes on.
4. **Build.** One scene per sub-composition under `compositions/`, mounted by the root `index.html` with `data-start`/`data-duration` clips on the storyboard's seconds; variables for copy, colours and media; the registry (`/hyperframes-registry`) before any hand-built effect. `npx hyperframes lint` while writing, `npx hyperframes check --json` as the gate; every error fixed, every warning weighed.
5. **Draft and sheets.** `npx hyperframes render video/<slug> --quality draft -o artifacts/video/<slug>/rounds/1/draft.mp4`, then `node video/lib/sheets.mjs <that> --out artifacts/video/<slug>/rounds/1 --strip <the fastest second>`; open the sheets and score them by `prompts/critique.md`.
6. **Critique rounds.** Fix the three worst problems, re-render only the span you touched (`--start`/`--end`), new sheets, score again; log every round in `docs/video/review_log.md`. Three rounds at least, until every axis is 8 or more.
7. **Sound.** Music from the Brief's attachment or a bundled track, sound effects on the cuts, the voice from `npx hyperframes tts` when the film is narrated, captions from `npx hyperframes transcribe` when it has them; placed `<audio>` elements with ids, mixed by the render.
8. **Deliver.** Per format: `npx hyperframes render video/<slug> --quality delivery -o artifacts/video/<slug>/render-<format>.mp4` (another format is its own reframed root composition, `--composition index-<format>.html`, never a crop), then `node video/lib/loudness.mjs … --out artifacts/video/<slug>/final-<format>.mp4`, `node video/lib/sheets.mjs final-<format>.mp4 --out artifacts/video/<slug>` (contact.png, phone.png, poster.png), and `node video/lib/verify.mjs final-<format>.mp4 --format <format> --composition video/<slug>/index.html` (exit 0). Only then hand in.

## Deliverables (the contract)

Under `artifacts/video/<slug>/`: `final-<format>.mp4` per format (H.264, yuv420p, 1080 wide or tall, the Brief's duration within 0.1 s, an audio stream, -14 LUFS ±1), `poster.png`, `contact.png`, `phone.png`, and `rounds/<n>/` with each round's sheets. Under `video/<slug>/`: the project, committed, with its `README.md` (from `templates/README.md`) that renders it again and a `.gitignore` for `renders/`, `.hyperframes/`, `.thumbnails/`. Under `docs/video/`: `style_guide.md` and `review_log.md` with every round's scores.

## The look

- One motif, transformed: the brand's most reduced element opens the film, becomes each shot's material, closes it.
- Paper, ink, one accent, one held-back colour. One display face, one mono face. Real screens, the real logo.
- Banned: a centred title on a gradient, everything fading in, corner labels and frame borders, glow on UI chrome, generic particle bursts, text sliding on a linear curve, a clip that ends before its end state.
- Content inside the 90 % action-safe box, captions and key text inside 80 % title-safe.
- Cut on the beat, animate on the off-beats; hits within 2 frames of a grid line.

## The scripts

| script | does |
|---|---|
| `scripts/scaffold.mjs <slug> [--title --version]` | `hyperframes init video/<slug>`, copies `lib/` to `video/lib/`, writes the review log and README, makes the rounds folder |
| `lib/sheets.mjs <mp4> --out <dir> [--strip s] [--poster s]` | contact, phone and poster; a strip of twelve frames |
| `lib/loudness.mjs <in.mp4> --out <final.mp4> [--lufs -14]` | two-pass loudnorm, video copied |
| `lib/verify.mjs <final.mp4> --format <f> (--duration s \| --composition index.html) [--silent-ok]` | the contract, measured |
