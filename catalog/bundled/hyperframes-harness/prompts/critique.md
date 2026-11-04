# Critique pass

Open the sheets for this film and look at them properly: `contact.png` (two frames a second), `strip.png` (twelve frames around the fastest move) and `phone.png` (how it reads 360 px wide). Be a harsh motion director, not a proud author.

Score each axis 1–10:

- **hook** — something striking inside the first 2 seconds; not a black frame, not a slow fade
- **readability** — every word legible at phone size, nothing cropped by the frame edge unless on purpose; captions inside the title-safe box
- **motion** — eased moves that settle, no sliding on a linear curve, no dead frames, no stutter, no element popping in without a reason
- **variety** — something new on screen every 2–4 seconds; density that breathes
- **composition** — off-centre where it should be, one accent, no corner labels or frame borders, no glow on UI chrome
- **brand** — the real colours, faces and words; the real screens; nothing invented
- **sound** — cuts on the beat, hits where the eye lands, voice intelligible over the music, no silence where a hit belongs

List the 3 biggest problems with timestamps. Hunt for: text overlapping during swaps, anything sliding instead of easing, a centred-title-on-gradient shot, blurry scaled text, a beat with nothing happening, a clip that ends before its end state, a caption out of sync with the voice. Fix them in the compositions, re-render only the span you touched (`npx hyperframes render --start <s> --end <s> --quality draft`), make new sheets, score again. Log every round in `docs/video/review_log.md` (`## Round N`, the scores per axis, the three problems, what changed). Stop when every axis is 8 or more, or after three rounds: then hand in with the scores and what you would improve next.
