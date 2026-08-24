#!/bin/sh
# The Claude config dir is a mounted volume, so tools that install into it cannot be baked into the image.
# On a *fresh* volume only (no skills dir yet) finish the setup; a mounted, already-populated ~/.claude is never touched.
set -e
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -z "$AI_ENGINE_SKIP_SETUP" ] && [ ! -d "$CFG/skills" ]; then
  graphify install --platform claude >/dev/null 2>&1 || true
fi
exec "$@"
