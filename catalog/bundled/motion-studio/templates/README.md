# FILM TITLE

A film that is a pure function of time: `motion/<slug>/index.html` paints any moment through `window.seek(t)`; the renderer screenshots every frame through a headless Chromium and ffmpeg stitches them. Made with Foundry's motion-studio engine.

## Render it again

```sh
# Playwright: the repository's own (npm i -D playwright && npx playwright install chromium), or FOUNDRY_PLAYWRIGHT when run by Foundry
node motion/lib/render.mjs motion/<slug> --out artifacts/motion/<slug>/silent-16x9.mp4 --format 16x9
node motion/lib/score.mjs --bpm 120 --dur 15 --out artifacts/motion/<slug>/score.wav
node motion/lib/sfx.mjs motion/<slug>/cues.json --out artifacts/motion/<slug>/sfx.wav --dur 15
node motion/lib/mix.mjs artifacts/motion/<slug>/silent-16x9.mp4 --out artifacts/motion/<slug>/final-16x9.mp4 --music artifacts/motion/<slug>/score.wav --sfx artifacts/motion/<slug>/sfx.wav
node motion/lib/sheets.mjs artifacts/motion/<slug>/final-16x9.mp4 --out artifacts/motion/<slug> --loop
node motion/lib/verify.mjs artifacts/motion/<slug>/final-16x9.mp4 --film motion/<slug> --format 16x9
```

Preview while editing: open `motion/<slug>/index.html` in a browser (it loops); `?format=9x16` for the vertical cut.
