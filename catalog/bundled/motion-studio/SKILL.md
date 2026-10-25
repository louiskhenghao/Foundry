---
name: motion-studio
description: Make a motion-graphics film rendered from code — a product reel, a brand film, a showreel, a kinetic-type explainer, a short for social — with Foundry's motion-studio engine. Use when a video goal's engine is motion-studio, or when asked for a launch video, a showreel, a motion reel, a brand film cut to music. A film is a pure function of time (window.seek(t)), rendered through a headless Chromium into H.264 by render.mjs, scored and mixed in code, judged on contact sheets, measured by verify.mjs.
---

# Motion studio

The prompt is a tenth of a film; this harness is the rest. A film here is one HTML page whose `window.seek(t)` paints the frame at second *t* onto a canvas, nothing more: no CSS transitions, no timers, no `requestAnimationFrame` while rendering, no state carried between frames, seeded noise only (`Motion.rng`, never `Math.random`). That is what makes any frame renderable alone, a re-render of three seconds cheap, and two renders identical.

The scripts live in this skill's `lib/`; `scripts/scaffold.mjs` copies them into the repository at `motion/lib/` so the film's source stands on its own. Every command below runs from the repository root. Node 22+, ffmpeg with ffprobe, and a Chromium: the repository's own Playwright if it has one, else the one Foundry hands the session as `FOUNDRY_PLAYWRIGHT`. Install nothing yourself.

## The gates, in order

1. **Intake.** Read the Brief: subject or product and its URL, duration, formats, brand colours and fonts, the reference (a frame, a clip, a folder of pictures — goal attachments), the music (a file, or "synthesise"), language, CTA. Gather real assets: screenshots of the real product through the Chromium the renderer uses, the real logo, real colours. Never redraw a product's UI from memory.
2. **Reference and style guide.** With a reference: extract a frame every half second (`ffmpeg -i ref.mp4 -vf fps=2 refs/%03d.png`), look at them, write `docs/motion/style_guide.md`: palette (hex), type (family, weight, tracking), shot lengths, transition kinds, camera moves, texture, how text enters and leaves. Take the grammar of the reference, never its content, logos or characters.
3. **Shotlist on the grid.** `node <skill>/scripts/scaffold.mjs <slug> --title "…" --dur 15 --formats 16x9,9x16 --bpm 120` lays the film out. Write `motion/<slug>/STORYBOARD.md`: BPM and beat length, one row per shot with its beats, what is on screen, what the motif does, the sound. A visual payoff every 3–5 seconds, something new every 2–4, a hook inside the first 2. The last frame sets up the first (a loop). This task is a milestone: it shows the shotlist and goes on.
4. **Stills.** One still per shot in `index.html` (`SCENES`, each `{ from, to, draw(t) }` with `t` local to the shot), a contact sheet, a critique. Fix the composition before anything moves.
5. **Animatic.** Every shot moving, placeholder sound, `--fps 24 --sub 1` for speed. Fix the pacing before polish.
6. **Full pass.** 60 fps, springs everywhere (`Motion.spring`, `Motion.track` for a value with several targets, `SPRINGS.snappy` for UI edges, `default` for cards and the camera, `heavy` for big type and lockups, `playful` for mascots), motion blur (`--sub 4`), the climax colour held back until the climax.
7. **Sound.** `score.mjs` synthesises a bed on the film's BPM (or `beats.mjs` measures the supplied track and the grid follows it); `sfx.mjs` puts clicks, pops, thumps and whooshes on the cues you list; `mix.mjs` mixes, limits, lands at -14 LUFS and muxes.
8. **Critique.** `sheets.mjs` makes `contact.png`, `strip.png` (around the fastest move) and `phone.png`; score them by `prompts/critique.md`; fix the three worst problems; re-render only the seconds you touched; three rounds at least, until every axis is 8 or more.
9. **Render and verify.** Every format from the same timeline (`--format`), never a crop. `verify.mjs` measures the file: codec, pixel format, size, duration, audio, loudness, the loop seam, determinism. Only then hand in.
10. **House style.** The last task writes `docs/motion/house-style.md` from `templates/house-style.md`: what the next film for this product starts from.

## The look

- One motif, transformed: the brand's most reduced element opens the film, becomes each shot's material, closes it as punctuation. Nearly every transition turns the current object into the next; hard cuts are for the flurry.
- Paper, ink, one accent, one held-back colour. One display face, one mono face. Three type voices at most.
- Banned: a centred title on a gradient, everything fading in, corner labels and frame borders, glow on UI chrome, generic particle bursts, text sliding on a fixed curve, `will-change` on anything the camera scales.
- Layout, not pixels: every shot places things by the layout object (`L`) so 9:16, 1:1 and 16:9 come from one timeline; reframe type and UI per format.
- Expensive motion has mass: it accelerates, overshoots a hair, settles. Cut on the beat, animate on the off-beats; hits within 2 frames of a grid line.

## Deliverables (the contract)

Under `artifacts/motion/<slug>/`: `final-<format>.mp4` per format (H.264, yuv420p, 1080 wide or tall, the Brief's duration, -14 LUFS), `loop_check.mp4`, `poster.png`, `contact.png`. Under `motion/<slug>/`: the source, `README.md` (from `templates/README.md`) with the commands that render it again. Under `docs/motion/`: the style guide, the review log (scores per round, the three problems each time), the house style. Frames, sheets and renders stay under `artifacts/`; the source is committed.

## The scripts

| script | does |
|---|---|
| `scripts/scaffold.mjs <slug> [--title --dur --fps --formats --bpm]` · `--sync` | lays the film out; rewrites `film.js` after you edit `film.json` |
| `lib/render.mjs <film> --out <mp4> [--format --fps --sub --from --to]` · `--hash` · `--seam` | renders; hashes a slice (determinism); measures the loop seam |
| `lib/sheets.mjs <mp4> --out <dir> [--strip s] [--poster s] [--loop]` | contact, phone and poster; a strip; the loop check |
| `lib/score.mjs --bpm --dur --out [--seed --key --mood --drop]` | a music bed on the grid |
| `lib/beats.mjs <track> [--hint]` | the grid of a supplied track (bpm, phase, beats, downbeats, hits) |
| `lib/sfx.mjs cues.json --out [--dur]` | sound effects on cue |
| `lib/mix.mjs <silent.mp4> --out <final.mp4> [--music --sfx --lufs]` | mix, limit, -14 LUFS, mux |
| `lib/verify.mjs <final.mp4> --film <dir> [--format --silent-ok --no-loop --no-determinism]` | the contract, measured |

`render.mjs` prints a line every second of film: keep it in the foreground. A render of 15 s at 60 fps with 4 subframes takes a few minutes; render the animatic at 24 fps and `--sub 1` while iterating.
