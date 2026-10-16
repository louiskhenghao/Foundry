#!/bin/sh
# foundry boundary guard — PreToolUse hook (matcher: Bash; and Skill, for the desktop-apps switch).
# Blocks commands that would leave the local worktree (Escalation trigger 3) and, while Settings → Safety →
# "Desktop apps & printers" is off, commands that bring a desktop app up or hand a file to a printer, and the skills that do.
# Exit 2 + stderr => Claude sees a denial. The engine is notified via callback so the
# escalation is raised deterministically even if the model retries.
#
# Env (set by the runner):
#   FOUNDRY_CALLBACK   base URL of the engine's internal API (e.g. http://127.0.0.1:4111)
#   FOUNDRY_ATTEMPT_ID current attempt id
#   FOUNDRY_GUARD_LOG  optional path to append hook input for debugging/verification
#   FOUNDRY_EXTRA_PATTERNS  optional '|' separated extra ERE patterns
#   FOUNDRY_DESKTOP_PATTERNS  optional ERE of the commands that open desktop apps or hand files to printers, grepped
#                             over the Bash command alone while the switch above is off
#   FOUNDRY_SLICER_PATTERNS   optional ERE of the slicers' own programs: blocked unless the command also matches
#   FOUNDRY_HEADLESS_PATTERNS   this ERE of their headless switches
#   FOUNDRY_DENIED_SKILLS   optional '|' separated skill names refused on the Skill tool (the same switch), bare or
#                           under their plugin's prefix (text-to-cad:bambu-labs)

input=$(cat)

if [ -n "$FOUNDRY_GUARD_LOG" ]; then
  printf '%s\n' "$input" >> "$FOUNDRY_GUARD_LOG"
fi

# the tool this call is for (the hook runs for Bash and for Skill); missing = a Bash payload from the Codex adapter
tool=$(printf '%s' "$input" | grep -Eo '"tool_name"[[:space:]]*:[[:space:]]*"[A-Za-z_]+"' | head -1 | sed -E 's/.*"([A-Za-z_]+)"$/\1/')

# $1 = why it was blocked (boundary | desktop | skill): the engine words the Inbox item by it
notify() {
  if [ -n "$FOUNDRY_CALLBACK" ]; then
    curl -s -m 3 -X POST "$FOUNDRY_CALLBACK/internal/boundary" \
      -H 'content-type: application/json' \
      -H "x-foundry-attempt: ${FOUNDRY_ATTEMPT_ID:-}" \
      -H "x-foundry-reason: ${1:-boundary}" \
      --data-binary "$input" >/dev/null 2>&1 || true
  fi
}

# desktop apps and printers: a skill behind the switch, by its own name or under its plugin's (text-to-cad:bambu-labs)
if [ "$tool" = "Skill" ]; then
  if [ -n "$FOUNDRY_DENIED_SKILLS" ] && printf '%s' "$input" | grep -Eq -e "\"skill\"[[:space:]]*:[[:space:]]*\"([^\":]*:)?($FOUNDRY_DENIED_SKILLS)\""; then
    notify skill
    echo "BLOCKED by foundry: this skill opens a desktop app or hands a file to a printer on this computer. Settings → Safety → \"Desktop apps & printers\" opens it — do NOT retry or work around it. Finish your task without it and mention that it was blocked." >&2
    exit 2
  fi
  exit 0
fi

# the Bash command alone, still JSON-escaped: the call's other fields (cwd, description) never meet the desktop patterns
command=$(printf '%s' "$input" | grep -Eo '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
[ -n "$command" ] || command=$input
desktop=0
# -e: a pattern may start with a dash (the headless switches do)
if [ -n "$FOUNDRY_DESKTOP_PATTERNS" ] && printf '%s' "$command" | grep -Eq -e "$FOUNDRY_DESKTOP_PATTERNS"; then
  desktop=1
elif [ -n "$FOUNDRY_SLICER_PATTERNS" ]; then
  # a slicer's program brings its window up unless that very command carries its headless switches: the line is read one
  # command at a time (split at ; && || | and escaped newlines), so a headless run never excuses a window after it
  printf '%s\n' "$command" | awk '{ gsub(/&&|\|\||[;|]|\\n/, "\n"); print }' | while IFS= read -r seg; do
    if printf '%s' "$seg" | grep -Eq -e "$FOUNDRY_SLICER_PATTERNS"; then
      if [ -z "$FOUNDRY_HEADLESS_PATTERNS" ] || ! printf '%s' "$seg" | grep -Eq -e "$FOUNDRY_HEADLESS_PATTERNS"; then
        exit 3
      fi
    fi
  done
  [ $? -eq 3 ] && desktop=1
fi
if [ "$desktop" = 1 ]; then
  notify desktop
  echo "BLOCKED by foundry: this command opens a desktop app or hands a file to a printer on this computer. Settings → Safety → \"Desktop apps & printers\" opens it — do NOT retry or work around it. Finish your task without it and mention that it was blocked." >&2
  exit 2
fi

# Extract tool_input.command without jq: crude but dependency-free. We match on the whole
# JSON payload, which is safe because the patterns are specific multi-word commands.
patterns='git[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+create|gh[[:space:]]+pr[[:space:]]+merge|gh[[:space:]]+release|npm[[:space:]]+publish|bun[[:space:]]+publish|yarn[[:space:]]+publish|pnpm[[:space:]]+publish|cargo[[:space:]]+publish|vercel[[:space:]]+deploy|vercel[[:space:]]+--prod|netlify[[:space:]]+deploy|flyctl[[:space:]]+deploy|fly[[:space:]]+deploy|wrangler[[:space:]]+deploy|terraform[[:space:]]+apply|pulumi[[:space:]]+up|kubectl[[:space:]]+apply|kubectl[[:space:]]+delete|docker[[:space:]]+push|aws[[:space:]]+s3[[:space:]]+(cp|sync|rm)|gcloud[[:space:]]+.*deploy|git[[:space:]]+remote[[:space:]]+(add|set-url)'
if [ -n "$FOUNDRY_EXTRA_PATTERNS" ]; then
  patterns="$patterns|$FOUNDRY_EXTRA_PATTERNS"
fi

if printf '%s' "$input" | grep -Eq "$patterns"; then
  notify boundary
  echo "BLOCKED by foundry: this command leaves the local worktree (push/PR/deploy/publish). It requires human approval — do NOT retry or work around it. Finish your task without it and mention that it was blocked." >&2
  exit 2
fi
exit 0
