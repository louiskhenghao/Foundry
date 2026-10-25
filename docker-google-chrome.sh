#!/bin/sh
# `google-chrome` (and `chromium`) for the skills a worker runs inside Foundry's image (ADR-0076): Colorfigures checks
# its own shots in headless Chrome by those names. The image has no browser of its own; this starts the Chromium that
# Playwright downloaded for the engine (Settings → Preview & self-check → Install Chromium), with the flags a root-less
# container needs. It is not a browser install: without that download it says where to get one and exits.
root="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
bin=""
for d in "$root"/chromium-*; do
  for c in "$d"/chrome-linux*/chrome; do [ -x "$c" ] && bin="$c"; done
done
if [ -z "$bin" ]; then
  for d in "$root"/chromium_headless_shell-*; do
    for c in "$d"/chrome-linux*/headless_shell; do [ -x "$c" ] && bin="$c"; done
  done
fi
if [ -z "$bin" ]; then
  echo "google-chrome: no Chromium under $root — download it in Foundry: Settings → Preview & self-check → Install Chromium" >&2
  exit 127
fi
exec "$bin" --no-sandbox --disable-gpu --disable-dev-shm-usage "$@"
