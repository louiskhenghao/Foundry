#!/usr/bin/env bash
# Foundry install for macOS and Linux (ADR-0024, ADR-0108):
#
#   curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
#
# It installs the newest release, checked against its SHA256SUMS, the way this computer runs it:
#
#   app      macOS (ADR-0105): Foundry.app in /Applications (or ~/Applications); its menu bar item runs Foundry and
#            starts it at login
#   binary   Linux (and macOS without the app): the compiled foundry, unpacked into
#            ~/.local/share/foundry/releases/<version> with a `current` link, run as a background service
#
# `foundry setup` then installs what is missing (git, uv, the coding agents' CLIs, graphify, GitHub CLI, Node.js, the
# optional tools you pick). An earlier Foundry on this computer (a checkout run from source, a Docker container) is
# found, and moving its goals here is offered (foundry migrate, ADR-0107): it stops, its data is copied with its paths
# pointed here, and it stays as it is, as the backup. There are no source or Docker installs any more (ADR-0108).
#
# Then it offers to sign in to the coding agents and GitHub, opens Foundry in the browser, and leaves a `foundry`
# command behind: foundry start | stop | restart | status | logs | open | update | uninstall [--purge]
#
# Options (or the environment variables in brackets):
#   --mode app|binary           how to run Foundry (default: the app on a Mac, the binary on Linux)   [FOUNDRY_MODE]
#   --version X.Y.Z             the release to install                         [FOUNDRY_VERSION, default the newest]
#   --app-dir PATH              app: where Foundry.app goes                     [FOUNDRY_APP_DIR, default /Applications,
#                               or ~/Applications when that is not writable]
#   --agent claude,codex,agy    the coding agents to set up, one or more; agy is Antigravity, both is claude,codex and
#                               all is the three (asked when not given)   [FOUNDRY_AGENT]
#   --port N                    the port to serve on (default: 4111, or the next free one)    [FOUNDRY_PORT]
#   --with "markitdown chromium docker ffmpeg"   exactly these optional tools   [FOUNDRY_WITH]
#   --yes                       take every default, ask nothing
#   --no-start                  set up, but do not start Foundry
#   --no-open                   do not open the browser
#   --no-modify-path            leave your shell's configuration alone
#   --dry-run                   say what would happen, change nothing
#
# What a running 2.x Foundry passes when it switches a checkout to the app or the binary (ADR-0106):
#   --from-file PATH            install this release file (already downloaded and checked), not GitHub's
#   --migrate-from DIR          the source install whose goals move here
#   --migrate-data PATH         the data folder it runs on, when not the checkout's own
#   --migrate-stop PID          the Foundry to stop before its data is copied
#
# What the app runs once a person moved an earlier install into it from its page (ADR-0107):
#   adopt --mode app|binary --bin PATH   that install becomes the one install.env names, with its foundry command
#
# Safe to run again: it finds the earlier install and updates it the same way.
set -Eeuo pipefail
# never stop without saying where: a failing command outside a condition names itself
trap 'printf "\n\033[31m✘ stopped: \"%s\" failed (install.sh line %s)\033[0m\n" "$BASH_COMMAND" "$LINENO" >&2' ERR

RAW_URL="${FOUNDRY_INSTALL_URL:-https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh}"
# app, binary: the releases on GitHub (ADR-0104); FOUNDRY_RELEASES_API points a test at a server of its own
RELEASES_API="${FOUNDRY_RELEASES_API:-https://api.github.com/repos/louiskhenghao/foundry-releases/releases}"
APP_ID="com.louiskhenghao.foundry"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/foundry"
STATE="$STATE_DIR/install.env"
SHARE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/foundry"
BIN_DIR="$HOME/.local/bin"
LABEL="dev.foundry.server"
# the PATH new terminals start with, before this script adds to its own
ORIG_PATH="$PATH"

# settings: flags › environment › the earlier install › defaults
MODE="" AGENT="" PORT="" SERVICE="" APP="" VERSION="" APP_DIR=""
# app, binary: the compiled foundry (the app's engine, or releases/current/foundry), and the release being installed
BIN="" REL_JSON="" REL_VERSION=""
# a switch from a running Foundry (ADR-0106): the release file it checked, and what foundry migrate moves and stops
FROM_FILE="" MIGRATE_FROM="" MIGRATE_DATA="" MIGRATE_STOP=""
YES=0 START=1 OPEN=1 MODIFY_PATH=1 DRY=0 PURGE=0 WITH="${FOUNDRY_WITH:-}"
main() {
  local cmd=install
  case "${1:-}" in install|start|stop|restart|status|logs|open|update|uninstall|adopt) cmd="$1"; shift ;; esac
  load_state
  # a 2.x source or Docker install (ADR-0108): this one installs the app or the binary, and offers to move its goals
  case "$MODE" in source|docker) MODE="" SERVICE="" ;; esac
  parse_flags "$@"
  case "$(uname -s)" in Darwin|Linux) ;; *) fail "Foundry runs on macOS and Linux; on Windows use WSL" ;; esac
  setup_tty
  case "$cmd" in
    install) install ;;
    update) update ;;
    adopt) adopt ;;
    *) [ -n "$MODE" ] || fail "Foundry is not installed yet: run the install first"; control "$cmd" ;;
  esac
}

# ---------- settings ----------

load_state() {
  [ -f "$STATE" ] || return 0
  # shellcheck disable=SC1090
  . "$STATE"
}

parse_flags() {
  MODE="${FOUNDRY_MODE:-$MODE}" AGENT="${FOUNDRY_AGENT:-$AGENT}" PORT="${FOUNDRY_PORT:-$PORT}"
  VERSION="${FOUNDRY_VERSION:-}" APP_DIR="${FOUNDRY_APP_DIR:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --mode) MODE="$2"; shift 2 ;;
      --agent) AGENT="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --version) VERSION="${2#v}"; shift 2 ;;
      --app-dir) APP_DIR="$2"; shift 2 ;;
      --from-file) FROM_FILE="$2"; shift 2 ;;
      --migrate-from) MIGRATE_FROM="$2"; shift 2 ;;
      --migrate-data) MIGRATE_DATA="$2"; shift 2 ;;
      --migrate-stop) MIGRATE_STOP="$2"; shift 2 ;;
      --bin) BIN="$2"; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --no-start) START=0; shift ;;
      --no-open) OPEN=0; shift ;;
      --no-modify-path) MODIFY_PATH=0; shift ;;
      --dry-run) DRY=1; shift ;;
      --purge) PURGE=1; shift ;;
      --with) WITH="$2"; shift 2 ;;
      -h|--help) sed -n '2,34p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null || printf 'see %s\n' "$RAW_URL"; exit 0 ;;
      *) fail "unknown option $1 (see --help)" ;;
    esac
  done
  if [ -n "$AGENT" ]; then AGENT="$(agents_from "$AGENT")" || fail "--agent takes claude, codex, agy, both or all, or several of them: claude,agy"; fi
  case "$MODE" in
    ""|app|binary) ;;
    # --mode, or FOUNDRY_MODE from `foundry update` in a 2.x install older than 2.36, which runs the newest installer
    source|docker) fail "Foundry installs only as the app (macOS) or the binary (Linux) since 3.0 (ADR-0108). A source or Docker install stays as it is and gets no more updates; install 3.0 with: curl -fsSL $RAW_URL | bash (it finds that install and offers to move its goals). To work on Foundry itself, run a checkout with: bun run serve" ;;
    *) fail "--mode must be app or binary" ;;
  esac
  case "$VERSION" in ""|[0-9]*.[0-9]*.[0-9]*) ;; *) fail "--version takes a release number, like 2.35.0" ;; esac
  if [ "$MODE" = app ] && ! is_mac; then fail "the app is for macOS; on Linux use --mode binary"; fi
  case "$PORT" in ""|[0-9]*) ;; *) fail "--port must be a number" ;; esac
}

save_state() {
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$STATE_DIR"
  {
    printf '# written by the Foundry installer; `foundry` reads it\n'
    for k in MODE AGENT PORT SERVICE APP; do printf '%s=%q\n' "$k" "${!k}"; done
  } > "$STATE"
}

# the coding agents as one list in a fixed order: "agy,Claude" or "claude agy" → claude,agy; both (what earlier
# installs saved) → claude,codex; all → claude,codex,agy. Fails on a name it does not know
agents_from() {
  local list a out=""
  list=",$(printf '%s' "$1" | tr ' A-Z' ',a-z'),"
  for a in $(printf '%s' "$list" | tr ',' ' '); do case "$a" in claude|codex|agy|antigravity|both|all) ;; *) return 1 ;; esac; done
  case "$list" in *,both,*) list="$list,claude,codex," ;; esac
  case "$list" in *,all,*) list="$list,claude,codex,agy," ;; esac
  case "$list" in *,antigravity,*) list="$list,agy," ;; esac
  for a in claude codex agy; do case "$list" in *",$a,"*) out="$out,$a" ;; esac; done
  [ -n "$out" ] || return 1
  printf '%s' "${out#,}"
}
uses() { case ",$AGENT," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
agents_without() { printf ',%s,' "$AGENT" | sed "s/,$1,/,/; s/^,//; s/,\$//"; }

# ---------- terminal ----------

TTY=""
setup_tty() {
  # piped through `curl | bash`, stdin is the script: questions go to the terminal itself
  if [ "$YES" = 0 ] && ( : </dev/tty >/dev/tty ) 2>/dev/null; then TTY=/dev/tty; else return 0; fi
  # the terminal's own device where it has one: a CLI built with Bun (Claude Code) cannot watch a descriptor opened
  # through /dev/tty on macOS and its sign-in dies with "EINVAL: invalid argument, kqueue"
  local dev
  dev="/dev/$(ps -o tty= -p $$ 2>/dev/null | tr -d ' ')"
  case "$dev" in /dev/|*\?*) ;; *) if [ -c "$dev" ] && ( : <"$dev" >"$dev" ) 2>/dev/null; then TTY="$dev"; fi ;; esac
}
ask() { # ask "question" default → the answer (the default without a terminal or with --yes)
  local reply=""
  if [ -z "$TTY" ]; then printf '%s' "$2"; return; fi
  printf '%s' "$1" >"$TTY"
  read -r reply <"$TTY" || reply=""
  printf '%s' "${reply:-$2}"
}
yesno() { # yesno "question" y|n → 0 for yes
  local hint="y/N"; [ "$2" = y ] && hint="Y/n"
  case "$(ask "  $1 [$hint] " "$2")" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

have() { command -v "$1" >/dev/null 2>&1; }
step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
plan() { printf '  \033[35m•\033[0m would %s\n' "$*"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
# a remote installer piped into a shell, tried three times: networks drop; its failure is reported by the caller
fetch_run() { # fetch_run URL shell [args…]
  local url="$1" i
  shift
  for i in 1 2 3; do
    curl -fsSL --retry 2 --retry-connrefused "$url" | "$@" && return 0
    sleep $((i * 3))
  done
  return 1
}
path_add() { case ":$PATH:" in *":$1:"*) ;; *) export PATH="$1:$PATH" ;; esac; }
sudo_cmd() { if [ "$(id -u)" = 0 ]; then "$@"; elif have sudo; then sudo "$@"; else return 1; fi; }
is_mac() { [ "$(uname -s)" = Darwin ]; }
arch() { case "$(uname -m)" in x86_64|amd64) echo x64 ;; arm64|aarch64) echo arm64 ;; *) uname -m ;; esac; }

# ---------- install ----------

install() {
  [ -n "$MODE" ] || choose_mode
  [ -n "$AGENT" ] || choose_agents
  if [ "$DRY" = 1 ]; then step "Dry run: nothing is installed, written or started"; fi
  case "$MODE" in
    app) install_app ;;
    binary) install_binary ;;
  esac
  save_state
  install_command
  modify_path
  finish
}

choose_mode() {
  # the release itself, compiled (ADR-0104, ADR-0105): the app on a Mac, the binary on Linux
  MODE=binary
  is_mac || return 0
  MODE=app
  if [ -n "$TTY" ]; then
    printf '\n\033[1mHow do you want to run Foundry?\033[0m\n' >"$TTY"
    printf '  1) The app      Foundry.app from the newest release, in the menu bar  (recommended)\n' >"$TTY"
    printf '  2) The binary   foundry from the newest release, run as a background service\n\n' >"$TTY"
  fi
  case "$(ask "Choice [1]: " 1)" in 2|b*|B*) MODE=binary ;; esac
}

# Claude Code unless other agents are ticked
choose_agents() {
  local items="claude codex agy" n i pick
  AGENT=claude
  [ -z "$TTY" ] && return 0
  path_add "$BIN_DIR"
  while :; do
    printf '\n\033[1mCoding agents\033[0m — type numbers to switch them on or off, Enter to go on:\n' >"$TTY"
    i=0
    for n in $items; do
      i=$((i + 1))
      printf '  %d) [%s] %s\n' "$i" "$(uses "$n" && echo x || echo ' ')" "$(agent_label "$n")" >"$TTY"
    done
    pick="$(ask "Switch: " "")"
    # none ticked is the default again
    if [ -z "$pick" ]; then AGENT="${AGENT:-claude}"; break; fi
    for i in $pick; do
      case "$i" in ''|*[!0-9]*) continue ;; esac
      n="$(echo "$items" | awk -v i="$i" '{print $i}')"
      [ -n "$n" ] || continue
      if uses "$n"; then AGENT="$(agents_without "$n")"; else AGENT="$(agents_from "$AGENT,$n")"; fi
    done
  done
}
agent_label() {
  case "$1" in
    claude) echo "Claude Code   Anthropic, signs in with a Claude account$(have claude && echo ' — installed')" ;;
    codex) echo "Codex         OpenAI, signs in with ChatGPT$(have codex && echo ' — installed')" ;;
    agy) echo "Antigravity   Google's agy, signs in with a Google account$(have agy && echo ' — installed')" ;;
  esac
}

# ---------- the release: app and binary modes (ADR-0104, ADR-0105) ----------

sha256_of() { if have sha256sum; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
# the release's JSON from GitHub: the one --version names, else the newest published one
resolve_release() {
  [ -n "$REL_JSON" ] && return 0
  # a file a running Foundry downloaded and checked: its name says the version
  if [ -n "$FROM_FILE" ]; then
    [ -f "$FROM_FILE" ] || fail "no such file: $FROM_FILE"
    REL_VERSION="$(basename "$FROM_FILE" | sed -n 's/^[Ff]oundry-\([0-9][0-9.]*[0-9]\)-.*/\1/p')"
    [ -n "$REL_VERSION" ] || fail "$FROM_FILE is not a Foundry release file"
    REL_JSON="(local file)"
    return 0
  fi
  local url="$RELEASES_API/latest"
  [ -n "$VERSION" ] && url="$RELEASES_API/tags/v$VERSION"
  REL_JSON="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$url" 2>/dev/null)" || fail "could not read the release from $url"
  REL_VERSION="$({ printf '%s' "$REL_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"v\{0,1\}\([^"]*\)"$/\1/'; } || true)"
  [ -n "$REL_VERSION" ] || fail "no release found at $url"
}
# a file of the release by name: its download address
asset_url() { { printf '%s' "$REL_JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(http[^"]*\)"$/\1/' | awk -v n="$1" '{ k = split($0, p, "/"); if (p[k] == n) { print; exit } }'; } || true; }
# download one file of the release into a folder, checked against the release's SHA256SUMS
fetch_release() { # fetch_release name dir
  local name="$1" dir="$2" url sums want got
  if [ -n "$FROM_FILE" ]; then
    [ "$(basename "$FROM_FILE")" = "$name" ] || fail "$FROM_FILE is not $name, the file for this computer"
    cp "$FROM_FILE" "$dir/$name"
    ok "$name, checked by the Foundry that switches"
    return 0
  fi
  url="$(asset_url "$name")"
  [ -n "$url" ] || fail "release $REL_VERSION has no $name"
  sums="$(asset_url SHA256SUMS)"
  [ -n "$sums" ] || fail "release $REL_VERSION has no SHA256SUMS"
  step "Downloading $name"
  curl -fSL --retry 3 --progress-bar -o "$dir/$name" "$url" || fail "could not download $name"
  want="$({ curl -fsSL --retry 3 "$sums" | awk -v n="$name" '$2 == n || $2 == "*" n {print $1; exit}'; } || true)"
  [ -n "$want" ] || fail "SHA256SUMS has no line for $name"
  got="$(sha256_of "$dir/$name")"
  [ "$got" = "$want" ] || fail "$name does not match SHA256SUMS (expected ${want:0:12}…, got ${got:0:12}…): nothing was installed"
  ok "checked against SHA256SUMS"
}

# what Foundry needs on this computer, by the compiled foundry itself (the Setup page's buttons run the same)
run_setup() {
  local with="" n
  for n in markitdown chromium ffmpeg; do [ "$(opt_get "$n")" = y ] && with="$with $n"; done
  if [ "$DRY" = 1 ]; then plan "run: foundry setup --agent $AGENT${with:+ --with \"${with# }\"}"; return 0; fi
  step "Installing what Foundry needs (foundry setup)"
  "$BIN" setup --agent "$AGENT" --with "${with# }" || warn "the list above says what is still missing; the Setup page installs most of it"
  # Linux: Chromium's system libraries, which only root can add
  if [ "$OPT_CHROMIUM" = y ] && ! is_mac; then sudo_cmd "$BIN" playwright install-deps chromium >/dev/null 2>&1 || warn "could not add Chromium's system libraries (needs sudo): sudo $BIN playwright install-deps chromium"; fi
  [ "$OPT_DOCKER" = y ] && { ensure_docker optional || true; }
  return 0
}

# an earlier Foundry's goals move to this one (ADR-0107): the switch names it, else the compiled foundry finds it (a
# checkout recorded or running, a Docker container), says what it found, and the person says yes. It stops, its data is
# copied with its paths pointed here, and it stays as it is, as the backup
migrate_source() {
  if [ "$DRY" = 1 ]; then plan "move the goals of an earlier Foundry on this computer, if there is one (foundry migrate)"; return 0; fi
  if [ -n "$MIGRATE_FROM" ]; then
    [ -f "$MIGRATE_FROM/apps/cli/src/main.ts" ] || return 0
    step "Your source install in $MIGRATE_FROM"
    # an array, empty or not: bash 3.2 with nounset refuses "${extra[@]}" when it is empty, hence the + form
    local -a extra=()
    [ -n "$MIGRATE_DATA" ] && extra+=(--data "$MIGRATE_DATA")
    [ -n "$MIGRATE_STOP" ] && extra+=(--stop-pid "$MIGRATE_STOP")
    [ -n "$PORT" ] && extra+=(--keep-port "$PORT")
    if ! "$BIN" migrate --from "$MIGRATE_FROM" ${extra[@]+"${extra[@]}"} --yes --no-adopt </dev/null; then
      # a switch whose data did not move does not start the new install: the old one is back, or says how to start it
      [ -n "$MIGRATE_STOP" ] && fail "the goals did not move, so the new install is not started; see the lines above"
      warn "the goals did not move; try again later with: foundry migrate --from $MIGRATE_FROM"
    fi
    return 0
  fi
  # 2.36's steps for a container (--no-start) move it themselves
  local -a scope=()
  [ "$START" = 0 ] && scope+=(--no-docker)
  # 0: one earlier Foundry with goals, 3: none, 4: several (the person chooses in Foundry or with foundry migrate --from)
  local found=0
  "$BIN" migrate --offer --dry-run ${scope[@]+"${scope[@]}"} </dev/null || found=$?
  [ "$found" = 0 ] || return 0
  if [ "$YES" = 1 ] || yesno "Move its goals here? It stops and stays as it is, as the backup." y; then
    "$BIN" migrate --offer --yes --no-adopt ${scope[@]+"${scope[@]}"} </dev/null || warn "the goals did not move; try again later with: foundry migrate"
  else
    note "left as it is; later: foundry migrate, or Bring your goals over in Foundry"
  fi
  return 0
}

# ---------- adopt (ADR-0107): an app or binary the goals moved into becomes the recorded install ----------
# The move runs the release's own copy of this script: install.env and the foundry command then name the install the
# goals are in now, not the checkout or the container they left.
adopt() {
  case "$MODE" in app|binary) ;; *) fail "adopt takes --mode app or --mode binary" ;; esac
  [ -n "$BIN" ] && [ -x "$BIN" ] || fail "adopt needs --bin, the foundry of that install"
  if [ "$MODE" = app ]; then
    APP="${BIN%/Contents/MacOS/foundry-engine}"
    SERVICE=app
  fi
  save_state
  install_command
  ok "the foundry command and $STATE now name the $MODE ($BIN)"
}

app_dir() { if [ -n "$APP_DIR" ]; then echo "$APP_DIR"; elif [ -w /Applications ]; then echo /Applications; else echo "$HOME/Applications"; fi; }
app_running() { pgrep -f "Foundry.app/Contents/MacOS/Foundry" >/dev/null 2>&1; }
quit_app() {
  app_running || return 0
  osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
  local i
  for i in $(seq 1 30); do app_running || return 0; sleep 1; done
  warn "Foundry.app did not quit within 30 seconds"
}
# where this install is: the app, or the binary's releases (a function: bash 3.2 cannot parse a case in $( ))
install_location() {
  case "$MODE" in
    app) echo "$APP" ;;
    binary) echo "$SHARE_DIR/releases/current" ;;
  esac
}
# the port the app's engine listens on, from what it wrote when it started
app_port() { { sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' "${FOUNDRY_HOME:-$HOME/.foundry}/app.json" 2>/dev/null | head -1; } || true; }

install_app() {
  have curl || fail "curl is needed"
  resolve_release
  local name="Foundry-$REL_VERSION-mac-universal.zip" tmp
  APP="$(app_dir)/Foundry.app"
  step "Foundry.app $REL_VERSION — coding agents: ${AGENT//,/, }, into $(app_dir)"
  choose_optional
  if [ "$DRY" = 1 ]; then
    plan "download $name, check it against SHA256SUMS and put Foundry.app in $(app_dir)"
    BIN="$APP/Contents/MacOS/foundry-engine"; run_setup; migrate_source
    plan "open Foundry.app: it runs Foundry from the menu bar and starts it at login"
    return 0
  fi
  tmp="$(mktemp -d)"
  fetch_release "$name" "$tmp"
  ditto -x -k "$tmp/$name" "$tmp/unpacked" || fail "could not unpack $name"
  [ -x "$tmp/unpacked/Foundry.app/Contents/MacOS/foundry-engine" ] || fail "$name holds no Foundry.app"
  quit_app
  mkdir -p "$(dirname "$APP")"
  # the app it replaces is kept until the new one is in place
  [ -e "$APP" ] && mv "$APP" "$tmp/Foundry.app.old"
  if ! mv "$tmp/unpacked/Foundry.app" "$APP"; then
    [ -e "$tmp/Foundry.app.old" ] && mv "$tmp/Foundry.app.old" "$APP"
    fail "could not put Foundry.app in $(dirname "$APP")"
  fi
  rm -rf "$tmp"
  BIN="$APP/Contents/MacOS/foundry-engine"
  SERVICE=app
  ok "Foundry.app $("$BIN" version 2>/dev/null | awk '{print $2}') in $(dirname "$APP")"
  run_setup
  migrate_source
  sign_in
  [ "$START" = 1 ] && start_app
  return 0
}

start_app() {
  if [ "$DRY" = 1 ]; then plan "open Foundry.app"; return 0; fi
  step "Starting Foundry (the menu bar app)"
  # --no-open: a page is open already (a switch) and reconnects by itself, so the app opens no new one
  if [ "$OPEN" = 1 ]; then open "$APP"; else open "$APP" --args --after-update; fi || { warn "Foundry.app did not open"; return 0; }
  local i
  for i in $(seq 1 90); do PORT="$(app_port)"; [ -n "$PORT" ] && healthy "$PORT" && { ok "Foundry is running: http://127.0.0.1:$PORT (its menu bar item has the rest)"; return 0; }; sleep 1; done
  warn "Foundry did not answer yet; its log: ~/Library/Logs/Foundry/app.log"
}

install_binary() {
  have curl || fail "curl is needed"
  have tar || fail "tar is needed"
  local target name tmp releases="$SHARE_DIR/releases"
  if is_mac; then target=darwin-universal
  else
    case "$(arch)" in x64|arm64) target="linux-$(arch)" ;; *) fail "there is no foundry build for $(uname -m): Foundry runs on x64 and arm64" ;; esac
    if ldd --version 2>&1 | grep -qi musl; then fail "the foundry binary needs glibc: Alpine and other musl systems cannot run it"; fi
  fi
  resolve_release
  name="foundry-$REL_VERSION-$target.tar.gz"
  BIN="$releases/current/foundry"
  step "foundry $REL_VERSION ($target) — coding agents: ${AGENT//,/, }, into $releases"
  choose_optional
  if [ "$DRY" = 1 ]; then
    plan "download $name, check it against SHA256SUMS, unpack it into $releases/$REL_VERSION and point $releases/current at it"
    run_setup; migrate_source; pick_port
    [ "$START" = 1 ] && start_service
    return 0
  fi
  tmp="$(mktemp -d)"
  fetch_release "$name" "$tmp"
  tar -xzf "$tmp/$name" -C "$tmp" || fail "could not unpack $name"
  [ -x "$tmp/foundry-$REL_VERSION/foundry" ] || fail "$name holds no foundry"
  mkdir -p "$releases"
  rm -rf "${releases:?}/$REL_VERSION"
  mv "$tmp/foundry-$REL_VERSION" "$releases/$REL_VERSION"
  rm -rf "$tmp"
  # `current` is what the service runs and what a self-update repoints: a relative link, beside the versions
  ln -sfn "$REL_VERSION" "$releases/current"
  ok "foundry $("$BIN" version 2>/dev/null | awk '{print $2}') in $releases/$REL_VERSION"
  run_setup
  migrate_source
  sign_in
  pick_port
  [ "$START" = 1 ] && start_service
  return 0
}

# ---------- optional tools ----------

OPT_MARKITDOWN=y OPT_CHROMIUM=y OPT_DOCKER=y OPT_FFMPEG=n

need_brew() {
  have brew && return 0
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && { eval "$("$b" shellenv)"; return 0; }; done
  if [ "$DRY" = 1 ]; then plan "install Homebrew"; return 0; fi
  step "Installing Homebrew (it asks for your password)"
  local script
  script="$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -n "$TTY" ]; then /bin/bash -c "$script" <"$TTY"; else NONINTERACTIVE=1 /bin/bash -c "$script"; fi
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  have brew || fail "Homebrew did not install; see https://brew.sh"
}

choose_optional() {
  local items="markitdown chromium docker ffmpeg" n i v
  if [ -n "$WITH" ]; then
    for n in $items; do case " $WITH " in *" $n "*) opt_set "$n" y ;; *) opt_set "$n" n ;; esac; done
    return 0
  fi
  # already there: nothing to choose
  have markitdown && OPT_MARKITDOWN=n
  have docker && OPT_DOCKER=n
  have ffmpeg && OPT_FFMPEG=n
  [ -z "$TTY" ] && return 0
  while :; do
    printf '\n\033[1mOptional tools\033[0m — type numbers to switch them on or off, Enter to go on:\n' >"$TTY"
    i=0
    for n in $items; do
      i=$((i + 1))
      v="$(opt_get "$n")"
      printf '  %d) [%s] %s\n' "$i" "$([ "$v" = y ] && echo x || echo ' ')" "$(opt_label "$n")" >"$TTY"
    done
    local pick
    pick="$(ask "Switch: " "")"
    [ -z "$pick" ] && break
    for i in $pick; do
      n="$(echo "$items" | awk -v i="$i" '{print $i}')"
      [ -n "$n" ] && opt_set "$n" "$([ "$(opt_get "$n")" = y ] && echo n || echo y)"
    done
  done
}
opt_get() { case "$1" in markitdown) echo "$OPT_MARKITDOWN" ;; chromium) echo "$OPT_CHROMIUM" ;; docker) echo "$OPT_DOCKER" ;; ffmpeg) echo "$OPT_FFMPEG" ;; esac; }
opt_set() { case "$1" in markitdown) OPT_MARKITDOWN="$2" ;; chromium) OPT_CHROMIUM="$2" ;; docker) OPT_DOCKER="$2" ;; ffmpeg) OPT_FFMPEG="$2" ;; esac; }
opt_label() {
  case "$1" in
    markitdown) echo "markitdown   turns attachments (PDF, Word, slides) into text the AI reads$(have markitdown && echo ' — installed')" ;;
    chromium) echo "Chromium     screenshots and console checks after each task (self-check)" ;;
    docker) echo "Docker       databases and other services previews need$(have docker && echo ' — installed')" ;;
    ffmpeg) echo "ffmpeg       video goals$(have ffmpeg && echo ' — installed')" ;;
  esac
}

sign_in() {
  [ "$DRY" = 1 ] && { plan "offer to sign in to the coding agents and GitHub"; return; }
  [ -z "$TTY" ] && return 0
  step "Signing in (Enter on a question skips it; the Setup page can do it later)"
  if uses claude && have claude && ! claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
    if yesno "Sign in to Claude Code now?" y; then claude auth login <"$TTY" >"$TTY" 2>&1 || warn "Claude Code sign-in did not finish"; fi
  fi
  if uses codex && have codex && ! codex login status >/dev/null 2>&1; then
    if yesno "Sign in to Codex now?" y; then codex login <"$TTY" >"$TTY" 2>&1 || warn "Codex sign-in did not finish"; fi
  fi
  # agy signs in from its own screen, which opens the browser; a read-only /usage answers once it has
  if uses agy && have agy && ! AGY_CLI_HIDE_LOGO=1 agy -p /usage --output-format json --print-timeout 1m </dev/null 2>/dev/null | grep -q '"status": *"SUCCESS"'; then
    if yesno "Sign in to Antigravity now (agy opens: sign in, then type /quit)?" y; then agy <"$TTY" >"$TTY" 2>&1 || warn "Antigravity sign-in did not finish"; fi
  fi
  if have gh && ! gh auth status >/dev/null 2>&1; then
    if yesno "Sign in to GitHub now (for pull requests)?" y; then gh auth login --web --git-protocol https <"$TTY" >"$TTY" 2>&1 || warn "GitHub sign-in did not finish"; fi
  fi
  # a declined question is not a failure: with errexit, `yesno … && …` as a function's last command would end the installer
  return 0
}

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" >/dev/null 2>&1; }

# 4111, or the next free port; the port this install already serves on stays
pick_port() {
  [ -n "$PORT" ] && { healthy "$PORT" || ! port_busy "$PORT"; } && return 0
  local p=4111
  while port_busy "$p" && ! { [ "$p" = "${PORT:-}" ] && healthy "$p"; }; do p=$((p + 1)); done
  [ "$p" != 4111 ] && note "port 4111 is taken; Foundry uses $p"
  PORT="$p"
}

xml() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
# systemd expands %-specifiers in unit values
unit_value() { printf '%s' "$1" | sed 's/%/%%/g'; }

# the launch profile: the one a move kept, for the goals were made with that coding agent (ADR-0107), else the first chosen
# agent, in the order Claude Code, Codex, Antigravity
provider() {
  local kept
  kept="$({ sed -n 's/.*"provider": *"\([a-z]*\)".*/\1/p' "${FOUNDRY_HOME:-$HOME/.foundry}/config.json" 2>/dev/null | head -1; } || true)"
  case "$kept" in claude|codex|agy) echo "$kept"; return 0 ;; esac
  if uses codex && ! uses claude; then echo codex; elif [ "$AGENT" = agy ]; then echo agy; else echo claude; fi
}

start_service() {
  if [ "$DRY" = 1 ]; then plan "run Foundry as a background service on port ${PORT:-4111} and open it"; return; fi
  local log_dir workdir
  # what foundry setup installs lands in ~/.local/bin: the service starts with it on its PATH (Bun keeps the PATH it started with)
  path_add "$BIN_DIR"
  # what the service runs: the release's current foundry (a self-update repoints `current`)
  local -a run_argv=("$SHARE_DIR/releases/current/foundry" serve)
  workdir="$HOME"
  log_dir="$([ "$(uname -s)" = Darwin ] && echo "$HOME/Library/Logs/Foundry" || echo "$SHARE_DIR/logs")"
  mkdir -p "$log_dir"
  step "Starting Foundry on port $PORT"
  if is_mac; then
    SERVICE=launchd
    local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$(dirname "$plist")"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>$(for a in "${run_argv[@]}"; do printf '<string>%s</string>' "$(xml "$a")"; done)</array>
  <key>WorkingDirectory</key><string>$(xml "$workdir")</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(xml "$PATH")</string>
    <key>HOME</key><string>$(xml "$HOME")</string>
    <key>FOUNDRY_PORT</key><string>$PORT</string>
    <key>FOUNDRY_PROVIDER</key><string>$(provider)</string>
    <key>FOUNDRY_SUPERVISED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$log_dir/foundry.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log_dir/foundry.log")</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
  elif systemctl --user show-environment >/dev/null 2>&1; then
    SERVICE=systemd
    local unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/foundry.service"
    mkdir -p "$(dirname "$unit")"
    cat >"$unit" <<EOF
[Unit]
Description=Foundry
After=network-online.target

[Service]
WorkingDirectory=$(unit_value "$workdir")
ExecStart=$(for a in "${run_argv[@]}"; do printf '%s ' "$(unit_value "$a")"; done)
Environment="PATH=$(unit_value "$PATH")" "FOUNDRY_PORT=$PORT" "FOUNDRY_PROVIDER=$(provider)" "FOUNDRY_SUPERVISED=1"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now foundry.service >/dev/null 2>&1
    systemctl --user restart foundry.service
    # without lingering, user services stop when the last session ends (a server you SSH into)
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = no ]; then loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || warn "Foundry stops when you log out; keep it running with: sudo loginctl enable-linger $(id -un)"; fi
  else
    # no service manager for this user (a container, WSL without systemd): a background process
    SERVICE=process
    process_stop
    mkdir -p "$SHARE_DIR"
    # exec: the background job is Foundry itself, so its pid is the one recorded, and it holds none of this terminal
    (cd "$workdir" && FOUNDRY_PORT="$PORT" FOUNDRY_PROVIDER="$(provider)" exec nohup "${run_argv[@]}" </dev/null >>"$log_dir/foundry.log" 2>&1) &
    echo $! >"$SHARE_DIR/foundry.pid"
    warn "no service manager here: Foundry runs in the background but does not start again after a reboot (foundry start)"
  fi
  wait_healthy
}

process_stop() {
  local pid_file="$SHARE_DIR/foundry.pid"
  [ -f "$pid_file" ] && kill "$(cat "$pid_file")" 2>/dev/null || true
  rm -f "$pid_file"
}

wait_healthy() {
  local i
  for i in $(seq 1 90); do healthy "$PORT" && { ok "Foundry is running: http://127.0.0.1:$PORT"; return 0; }; sleep 1; done
  warn "Foundry did not answer on port $PORT yet; see: foundry logs"
  return 0
}

# ---------- Docker, the optional tool previews start services with ----------

DOCKER="docker"

# Docker installed and running; `optional` only warns when that fails
ensure_docker() {
  local need="${1:-required}"
  if have docker && docker info >/dev/null 2>&1; then ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"; return 0; fi
  if have docker && sudo_cmd docker info >/dev/null 2>&1; then DOCKER="sudo docker"; ok "Docker (through sudo until you log in again)"; return 0; fi
  if [ "$DRY" = 1 ]; then plan "install Docker$(is_mac && echo ' Desktop (Homebrew)' || echo ' (get.docker.com)')"; return 0; fi
  if ! have docker; then
    step "Installing Docker"
    if is_mac; then
      need_brew && brew install --cask docker || { [ "$need" = optional ] && { warn "Docker did not install"; return 1; }; fail "Docker did not install"; }
      note "Docker Desktop is free for personal use and small companies; larger companies need a paid subscription."
    else
      fetch_run https://get.docker.com sudo_cmd sh || { [ "$need" = optional ] && { warn "Docker did not install"; return 1; }; fail "Docker did not install; see https://docs.docker.com/engine/install/"; }
      sudo_cmd usermod -aG docker "$(id -un)" 2>/dev/null || true
    fi
  fi
  if is_mac; then
    open -a Docker 2>/dev/null || true
    note "waiting for Docker Desktop to start (accept its terms if it asks)…"
  else
    sudo_cmd systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  local i
  for i in $(seq 1 120); do
    docker info >/dev/null 2>&1 && { DOCKER=docker; break; }
    sudo_cmd docker info >/dev/null 2>&1 && { DOCKER="sudo docker"; break; }
    sleep 2
  done
  if ! $DOCKER info >/dev/null 2>&1; then
    [ "$need" = optional ] && { warn "Docker is installed but not running yet"; return 1; }
    fail "Docker is installed but not running; start it, then run this again"
  fi
  ok "Docker $($DOCKER version --format '{{.Server.Version}}' 2>/dev/null)"
}

# ---------- the foundry command, PATH, the end ----------

install_command() {
  if [ "$DRY" = 1 ]; then plan "add the foundry command to $BIN_DIR"; return; fi
  mkdir -p "$SHARE_DIR" "$BIN_DIR"
  local self="${BASH_SOURCE[0]:-}"
  # run through `curl | bash` there is no file: fetch the same script for the command to use
  if [ -n "$self" ] && [ -f "$self" ]; then cp "$self" "$SHARE_DIR/install.sh.new"; else curl -fsSL "$RAW_URL" -o "$SHARE_DIR/install.sh.new"; fi
  mv "$SHARE_DIR/install.sh.new" "$SHARE_DIR/install.sh"
  # the installer's verbs run the installer; every other command is the compiled foundry's (foundry ask, usage, doctor…)
  cat >"$BIN_DIR/foundry" <<EOF
#!/usr/bin/env bash
# Foundry's own command (written by its installer): foundry start | stop | restart | status | logs | open | update | uninstall
# run the installer; anything else is Foundry's CLI (foundry ask, foundry usage, foundry doctor…), and foundry status <goal>
case "\${1:-status}" in
  start|stop|restart|logs|open|update|uninstall) exec bash "$SHARE_DIR/install.sh" "\$@" ;;
  status) [ \$# -le 1 ] && exec bash "$SHARE_DIR/install.sh" status ;;
esac
exec "$BIN" "\$@"
EOF
  chmod +x "$BIN_DIR/foundry"
}

modify_path() {
  local need="" dir
  for dir in "$BIN_DIR"; do
    case ":$ORIG_PATH:" in *":$dir:"*) ;; *) { [ -d "$dir" ] || [ "$DRY" = 1 ]; } && need="$need $dir" ;; esac
  done
  [ -z "$need" ] && return 0
  local shell_name rc line
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) rc="$HOME/.bashrc"; is_mac && rc="$HOME/.bash_profile" ;;
    fish) rc="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/foundry.fish" ;;
    *) rc="$HOME/.profile" ;;
  esac
  if [ "$MODIFY_PATH" = 0 ]; then
    note "add these to your PATH for new terminals:$need"
    return 0
  fi
  grep -qs '# >>> foundry >>>' "$rc" && return 0
  if [ "$DRY" = 1 ]; then plan "add$need to PATH in $rc"; return 0; fi
  mkdir -p "$(dirname "$rc")"
  if [ "$shell_name" = fish ]; then line="fish_add_path$need"; else line="export PATH=\"$(echo "$need" | sed 's/^ //; s/ /:/g'):\$PATH\""; fi
  printf '\n# >>> foundry >>>\n%s\n# <<< foundry <<<\n' "$line" >>"$rc"
  ok "added$need to PATH in $rc (new terminals)"
}

open_browser() {
  [ "$OPEN" = 1 ] || return 0
  local url="http://127.0.0.1:$PORT"
  if is_mac; then open "$url" 2>/dev/null || true
  elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && have xdg-open; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

finish() {
  [ "$DRY" = 1 ] && { printf '\n'; return 0; }
  printf '\n\033[1mFoundry is set up (%s).\033[0m\n' "$MODE"
  [ "$MODE" = app ] && PORT="$(app_port)"
  if [ "$START" = 1 ] && healthy "$PORT"; then
    printf '  Open:     http://127.0.0.1:%s\n' "$PORT"
    open_browser
  else
    printf '  Start it: foundry start\n'
  fi
  printf '  Manage:   foundry status | logs | stop | start | update | uninstall\n'
  [ "$MODE" = app ] && printf '            and the Foundry item in the menu bar\n'
  printf '\n'
}

# ---------- foundry <command> ----------

control() {
  case "$1" in
    start)
      if [ "$MODE" = app ]; then start_app
      else pick_port; start_service; save_state; fi ;;
    stop)
      if [ "$MODE" = app ]; then quit_app
      elif [ "$SERVICE" = launchd ]; then launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      elif [ "$SERVICE" = systemd ]; then systemctl --user stop foundry.service
      else process_stop; fi
      ok "Foundry stopped" ;;
    restart) control stop; control start ;;
    status)
      # the app's port only while the app runs: otherwise whatever answers on 4111 is not this install
      if [ "$MODE" = app ]; then if app_running; then PORT="$(app_port)"; else printf 'Foundry (app) in %s: \033[33mnot running\033[0m (foundry start, or open Foundry.app)\n' "$APP"; return 0; fi; fi
      printf 'Foundry (%s) in %s, port %s: ' "$MODE" "$(install_location)" "${PORT:-4111}"
      healthy "${PORT:-4111}" && printf '\033[32mrunning\033[0m — http://127.0.0.1:%s\n' "${PORT:-4111}" || printf '\033[33mnot answering\033[0m (foundry start, foundry logs)\n' ;;
    logs)
      if [ "$MODE" = app ]; then tail -n 200 -f "$HOME/Library/Logs/Foundry/app.log"
      elif [ "$SERVICE" = systemd ]; then journalctl --user -u foundry.service -f -n 200
      else tail -n 200 -f "$([ "$(uname -s)" = Darwin ] && echo "$HOME/Library/Logs/Foundry" || echo "$SHARE_DIR/logs")/foundry.log"; fi ;;
    open) [ "$MODE" = app ] && PORT="$(app_port)"; PORT="${PORT:-4111}"; open_browser; printf 'http://127.0.0.1:%s\n' "$PORT" ;;
    uninstall) uninstall ;;
  esac
}

# the newest installer, run the same way as last time
update() {
  [ -n "$MODE" ] || { install; return; }
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL "$RAW_URL" -o "$tmp"; then
    FOUNDRY_MODE="$MODE" exec bash "$tmp" install --yes
  fi
  warn "could not fetch the newest installer; updating with this one"
  YES=1 install
}

uninstall() {
  step "Removing Foundry's service and command"
  if [ "$MODE" = app ]; then
    quit_app
    # the app goes to the Trash, where it can still be taken back
    [ -d "$APP" ] && { mkdir -p "$HOME/.Trash"; mv "$APP" "$HOME/.Trash/Foundry-$(date +%Y%m%d%H%M%S).app"; ok "Foundry.app moved to the Trash"; }
    local data="$HOME/Library/Application Support/Foundry"
    if [ "$PURGE" = 1 ] && [ -d "$data" ] && yesno "Delete $data, with Foundry's data (goal history, settings)? Your repositories are not touched." n; then rm -rf "$data"; fi
  else
    control stop >/dev/null 2>&1 || true
    rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ "$SERVICE" = systemd ]; then systemctl --user disable foundry.service >/dev/null 2>&1 || true; rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/foundry.service"; systemctl --user daemon-reload || true; fi
    rm -rf "${SHARE_DIR:?}/releases"
    if [ "$PURGE" = 1 ] && [ -d "$SHARE_DIR/data" ] && yesno "Delete $SHARE_DIR/data, with Foundry's data (goal history, settings)? Your repositories are not touched." n; then rm -rf "$SHARE_DIR/data" "$SHARE_DIR"/data-*; fi
  fi
  # the Node.js and GitHub CLI foundry setup put in $SHARE_DIR stay: other tools use them
  rm -f "$BIN_DIR/foundry" "$STATE" "$SHARE_DIR/install.sh" "$SHARE_DIR/foundry.pid"
  local rc
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$rc" ] && grep -q '# >>> foundry >>>' "$rc" && sed -i.bak '/# >>> foundry >>>/,/# <<< foundry <<</d' "$rc" && rm -f "$rc.bak"
  done
  rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/foundry.fish"
  local kept="in ~/Library/Application Support/Foundry"
  [ "$MODE" = binary ] && kept="in $SHARE_DIR/data"
  ok "Foundry is removed$([ "$PURGE" = 1 ] || echo "; its data stays $kept (foundry uninstall --purge deletes it)"). gh, uv and the other tools stay installed."
}

main "$@"
