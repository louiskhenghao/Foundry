# Critique pass

Open the sheets for this film and look at them properly: `contact.png` (two frames a second), `strip.png` (twelve frames around the fastest move) and `phone.png` (how it reads 360 px wide). Be a harsh motion director, not a proud author.

Score each axis 1–10:

- **hook** — something striking inside the first 2 seconds; not a black frame, not a slow fade
- **readability** — every word legible at phone size, nothing cropped by the frame edge unless on purpose
- **motion** — springs that settle, no sliding on a fixed curve, no dead frames, no stutter
- **variety** — something new on screen every 2–4 seconds; density that breathes
- **composition** — off-centre where it should be, one accent, no corner labels or frame borders, no glow on UI chrome
- **brand** — the real colours, faces and words; nothing invented
- **sound** — cuts on the grid, hits on the beat, no silence where a hit belongs

List the 3 biggest problems with timestamps. Hunt for: text overlapping during swaps, anything sliding instead of easing, a centred-title-on-gradient shot, blurry scaled text, a beat with nothing happening, a stutter at the loop seam. Fix them, re-render only the affected seconds (`render.mjs --from s --to s`), make new sheets, score again. Stop when every axis is 8 or more, or after three rounds: then hand in with the scores and what you would improve next.
