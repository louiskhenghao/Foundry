# FILM TITLE

A HyperFrames film: `video/<slug>/index.html` is the root composition, one scene per sub-composition under `compositions/`, media under `assets/`; the CLI seeks a paused timeline frame by frame and encodes with ffmpeg. Made under Foundry's HyperFrames harness.

## Render it again

```sh
# Node 22+, FFmpeg; HyperFrames fetches the Chrome it renders with on the first run
npx --yes hyperframes@<version> check video/<slug> --json
npx --yes hyperframes@<version> render video/<slug> --quality delivery -o artifacts/video/<slug>/render-16x9.mp4
node video/lib/loudness.mjs artifacts/video/<slug>/render-16x9.mp4 --out artifacts/video/<slug>/final-16x9.mp4
node video/lib/sheets.mjs artifacts/video/<slug>/final-16x9.mp4 --out artifacts/video/<slug>
node video/lib/verify.mjs artifacts/video/<slug>/final-16x9.mp4 --format 16x9 --composition video/<slug>/index.html
```

Another format is its own root composition, reframed by hand (`video/<slug>/index-9x16.html`), rendered with `--composition index-9x16.html`.

Edit it: `npx --yes hyperframes@<version> preview video/<slug>` opens the browser editor; in Foundry, the goal page's Editor row does the same.
