#!/bin/sh
# ai-engine boundary guard — PreToolUse hook (matcher: Bash).
# Blocks commands that would leave the local worktree (Escalation trigger 3).
# Exit 2 + stderr => Claude sees a denial. The engine is notified via callback so the
# escalation is raised deterministically even if the model retries.
#
# Env (set by the runner):
#   AI_ENGINE_CALLBACK   base URL of the engine's internal API (e.g. http://127.0.0.1:4111)
#   AI_ENGINE_ATTEMPT_ID current attempt id
#   AI_ENGINE_GUARD_LOG  optional path to append hook input for debugging/verification
#   AI_ENGINE_EXTRA_PATTERNS  optional '|' separated extra ERE patterns

input=$(cat)

if [ -n "$AI_ENGINE_GUARD_LOG" ]; then
  printf '%s\n' "$input" >> "$AI_ENGINE_GUARD_LOG"
fi

# Extract tool_input.command without jq: crude but dependency-free. We match on the whole
# JSON payload, which is safe because the patterns are specific multi-word commands.
patterns='git[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+create|gh[[:space:]]+pr[[:space:]]+merge|gh[[:space:]]+release|npm[[:space:]]+publish|bun[[:space:]]+publish|yarn[[:space:]]+publish|pnpm[[:space:]]+publish|cargo[[:space:]]+publish|vercel[[:space:]]+deploy|vercel[[:space:]]+--prod|netlify[[:space:]]+deploy|flyctl[[:space:]]+deploy|fly[[:space:]]+deploy|wrangler[[:space:]]+deploy|terraform[[:space:]]+apply|pulumi[[:space:]]+up|kubectl[[:space:]]+apply|kubectl[[:space:]]+delete|docker[[:space:]]+push|aws[[:space:]]+s3[[:space:]]+(cp|sync|rm)|gcloud[[:space:]]+.*deploy|git[[:space:]]+remote[[:space:]]+(add|set-url)'
if [ -n "$AI_ENGINE_EXTRA_PATTERNS" ]; then
  patterns="$patterns|$AI_ENGINE_EXTRA_PATTERNS"
fi

if printf '%s' "$input" | grep -Eq "$patterns"; then
  if [ -n "$AI_ENGINE_CALLBACK" ]; then
    curl -s -m 3 -X POST "$AI_ENGINE_CALLBACK/internal/boundary" \
      -H 'content-type: application/json' \
      -H "x-ai-engine-attempt: ${AI_ENGINE_ATTEMPT_ID:-}" \
      --data-binary "$input" >/dev/null 2>&1 || true
  fi
  echo "BLOCKED by ai-engine: this command leaves the local worktree (push/PR/deploy/publish). It requires human approval — do NOT retry or work around it. Finish your task without it and mention that it was blocked." >&2
  exit 2
fi
exit 0
