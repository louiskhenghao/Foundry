#!/usr/bin/env bash
# Foundry install for macOS and Linux (ADR-0024):
#
#   curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
#
# It asks how to run Foundry and which coding agents to use, then sets up everything that way:
#
#   source   on this computer: installs what is missing (git, Bun, uv, graphify, the coding agents' CLIs, GitHub CLI,
#            Node.js, and the optional tools you pick), brings a coding agent's CLI that is already there up to its
#            newest release, builds Foundry, and runs it as a background service
#   docker   in a container: installs Docker if needed, writes the compose files to the folder and starts it
#
# Then it offers to sign in to the coding agents and GitHub, opens Foundry in the browser, and leaves a `foundry`
# command behind: foundry start | stop | restart | status | logs | open | update | uninstall [--purge]
#
# Options (or the environment variables in brackets):
#   --mode source|docker        how to run Foundry (asked when not given)       [FOUNDRY_MODE]
#   --agent claude,codex,agy    the coding agents to set up, one or more; agy is Antigravity (source only),
#                               both is claude,codex and all is the three (asked when not given)   [FOUNDRY_AGENT]
#   --dir PATH                  where Foundry goes                              [FOUNDRY_DIR, default ~/foundry]
#   --repos PATH                docker: your projects folder                    [FOUNDRY_REPOS, default ~/Projects]
#   --port N                    the port to serve on (default: 4111, or the next free one)    [FOUNDRY_PORT]
#   --ref BRANCH|TAG            source: what to check out                       [FOUNDRY_REF, default main]
#   --with "markitdown chromium docker ffmpeg"   source: exactly these optional tools   [FOUNDRY_WITH]
#   --with hindsight            docker: a Hindsight server beside Foundry for Memory (ADR-0072), with an LLM key
#                               of yours (asked, or HINDSIGHT_API_LLM_PROVIDER / _API_KEY / _MODEL)
#   --yes                       take every default, ask nothing
#   --no-start                  set up, but do not start Foundry
#   --no-open                   do not open the browser
#   --no-modify-path            leave your shell's configuration alone
#   --dry-run                   say what would happen, change nothing
#
# Safe to run again: it finds the earlier install and updates it the same way.
set -Eeuo pipefail
# never stop without saying where: a failing command outside a condition names itself
trap 'printf "\n\033[31m✘ stopped: \"%s\" failed (install.sh line %s)\033[0m\n" "$BASH_COMMAND" "$LINENO" >&2' ERR

RAW_URL="${FOUNDRY_INSTALL_URL:-https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh}"
IMAGE="${FOUNDRY_IMAGE:-imlouiskhenghao/foundry}"
STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/foundry"
STATE="$STATE_DIR/install.env"
SHARE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/foundry"
BIN_DIR="$HOME/.local/bin"
LABEL="dev.foundry.server"
# the PATH new terminals start with, before this script adds to its own
ORIG_PATH="$PATH"

# settings: flags › environment › the earlier install › defaults
MODE="" AGENT="" DIR="" REPOS="" PORT="" REF="" REPO="" HOST_DOCKER="" SERVICE=""
# docker: a Hindsight server for Memory (ADR-0072); its key lives in hindsight.env beside the compose file, never here
MEMORY="" HINDSIGHT_PROVIDER="" HINDSIGHT_MODEL="" HINDSIGHT_KEY=""
YES=0 START=1 OPEN=1 MODIFY_PATH=1 DRY=0 PURGE=0 WITH="${FOUNDRY_WITH:-}"

main() {
  local cmd=install
  case "${1:-}" in install|start|stop|restart|status|logs|open|update|uninstall) cmd="$1"; shift ;; esac
  load_state
  parse_flags "$@"
  case "$(uname -s)" in Darwin|Linux) ;; *) fail "Foundry runs on macOS and Linux; on Windows use WSL" ;; esac
  setup_tty
  prefer_bun
  case "$cmd" in
    install) install ;;
    update) update ;;
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
  MODE="${FOUNDRY_MODE:-$MODE}" AGENT="${FOUNDRY_AGENT:-$AGENT}" DIR="${FOUNDRY_DIR:-${DIR:-$HOME/foundry}}"
  REPOS="${FOUNDRY_REPOS:-${REPOS:-$HOME/Projects}}" PORT="${FOUNDRY_PORT:-$PORT}" REF="${FOUNDRY_REF:-${REF:-main}}"
  REPO="${FOUNDRY_REPO:-${REPO:-https://github.com/louiskhenghao/Foundry.git}}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --mode) MODE="$2"; shift 2 ;;
      --agent) AGENT="$2"; shift 2 ;;
      --dir) DIR="$2"; shift 2 ;;
      --repos) REPOS="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      --ref) REF="$2"; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --no-start) START=0; shift ;;
      --no-open) OPEN=0; shift ;;
      --no-modify-path) MODIFY_PATH=0; shift ;;
      --dry-run) DRY=1; shift ;;
      --purge) PURGE=1; shift ;;
      --with) WITH="$2"; shift 2 ;;
      -h|--help) sed -n '2,31p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null || printf 'see %s\n' "$RAW_URL"; exit 0 ;;
      *) fail "unknown option $1 (see --help)" ;;
    esac
  done
  if [ -n "$AGENT" ]; then AGENT="$(agents_from "$AGENT")" || fail "--agent takes claude, codex, agy, both or all, or several of them: claude,agy"; fi
  case "$MODE" in ""|source|docker) ;; *) fail "--mode must be source or docker" ;; esac
  case "$PORT" in ""|[0-9]*) ;; *) fail "--port must be a number" ;; esac
}

save_state() {
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$STATE_DIR"
  {
    printf '# written by the Foundry installer; `foundry` reads it\n'
    for k in MODE AGENT DIR REPOS PORT REF REPO HOST_DOCKER SERVICE MEMORY HINDSIGHT_PROVIDER HINDSIGHT_MODEL; do printf '%s=%q\n' "$k" "${!k}"; done
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
ask_secret() { # ask "question" default → the answer, typed without echo (a key)
  local reply=""
  if [ -z "$TTY" ]; then printf '%s' "$2"; return; fi
  printf '%s' "$1" >"$TTY"
  read -rs reply <"$TTY" || reply=""
  printf '\n' >"$TTY"
  printf '%s' "${reply:-$2}"
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
# a download unpacked into a folder, tried three times
fetch_tar() { # fetch_tar URL dir [tar options…]
  local url="$1" dir="$2" i
  shift 2
  for i in 1 2 3; do
    curl -fsSL --retry 2 --retry-connrefused "$url" | tar -xz -C "$dir" "$@" && return 0
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
    source) install_source ;;
    docker) install_docker ;;
  esac
  save_state
  install_command
  modify_path
  finish
}

choose_mode() {
  local suggested=2
  # a desktop (macOS, or Linux with a display) uses its own logins and tools; a headless server gets the container
  if is_mac || [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then suggested=1; fi
  if [ -n "$TTY" ]; then
    printf '\n\033[1mHow do you want to run Foundry?\033[0m\n' >"$TTY"
    printf '  1) From source  runs on this computer and uses its logins and tools%s\n' "$([ $suggested = 1 ] && echo '  (recommended here)')" >"$TTY"
    printf '  2) Docker       everything in a container%s\n\n' "$([ $suggested = 2 ] && echo '  (recommended here)')" >"$TTY"
  fi
  case "$(ask "Choice [$suggested]: " "$suggested")" in 2|d*|D*) MODE=docker ;; *) MODE=source ;; esac
}

# Claude Code unless other agents are ticked; the Docker image has no Antigravity CLI, so it is not offered there
choose_agents() {
  local items="claude codex agy" n i pick
  [ "$MODE" = docker ] && items="claude codex"
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

# ---------- source mode ----------

OPT_MARKITDOWN=y OPT_CHROMIUM=y OPT_DOCKER=y OPT_FFMPEG=n

install_source() {
  step "Foundry from source — coding agents: ${AGENT//,/, }, folder: $DIR"
  have curl || fail "curl is needed"
  need_git
  need_bun
  need_uv
  uses claude && need_claude
  uses codex && need_codex
  uses agy && need_agy
  need_graphify
  need_gh
  need_node
  choose_optional
  # Memory's server is a Docker component: from source, the person runs one and pastes its address on the Extensions page
  case " $WITH " in *" hindsight "*) warn "hindsight is a Docker component (--mode docker --with hindsight); from source, start a Hindsight server yourself and set its address on the Extensions page, MCP servers tab" ;; esac
  get_foundry
  [ "$OPT_MARKITDOWN" = y ] && need_markitdown
  [ "$OPT_CHROMIUM" = y ] && need_chromium
  [ "$OPT_DOCKER" = y ] && { ensure_docker optional || true; }
  [ "$OPT_FFMPEG" = y ] && need_ffmpeg
  sign_in_source
  run_doctor
  pick_port
  [ "$START" = 1 ] && start_service
  return 0
}

# a system package through whatever the machine has; sudo asks on the terminal
pkg_install() {
  if is_mac; then need_brew && brew install "$@"
  elif have apt-get; then sudo_cmd apt-get update -qq >/dev/null && sudo_cmd env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif have dnf; then sudo_cmd dnf install -y -q "$@"
  elif have yum; then sudo_cmd yum install -y -q "$@"
  elif have pacman; then sudo_cmd pacman -S --noconfirm --needed "$@"
  elif have apk; then sudo_cmd apk add --no-cache "$@"
  else return 1
  fi
}

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

need_git() {
  if have git; then ok "git $(git --version | awk '{print $3}')"; return; fi
  if [ "$DRY" = 1 ]; then plan "install git"; return; fi
  step "Installing git"
  if is_mac && ! have brew; then
    xcode-select --install 2>/dev/null || true
    fail "git comes with Apple's command line tools: finish the dialog that just opened, then run this again"
  fi
  pkg_install git || fail "could not install git; install it and run this again"
  ok "git installed"
}

# Foundry needs Bun 1.4 or newer: 1.3 closes a child's pipes twice and ends a preview's browser (oven-sh/bun#33828)
BUN_MIN=1.4.0
bun_new_enough() { # bun_new_enough "1.3.13" → 0 when the version is BUN_MIN or newer
  local v="${1%%[^0-9.]*}" a b c
  IFS=. read -r a b c <<<"$v"
  [ "${a:-0}" -gt 1 ] 2>/dev/null || { [ "${a:-0}" -eq 1 ] && [ "${b:-0}" -ge 4 ]; } 2>/dev/null
}
# the Bun Foundry runs on: the one Bun's installer put in ~/.bun/bin goes first once it is new enough, so that an older
# one elsewhere on PATH (Homebrew's, say) is not the one the service, the build and the foundry command pick up
prefer_bun() {
  if [ -x "$HOME/.bun/bin/bun" ] && bun_new_enough "$("$HOME/.bun/bin/bun" --version 2>/dev/null)"; then export PATH="$HOME/.bun/bin:$PATH"; hash -r; else path_add "$HOME/.bun/bin"; fi
}
need_bun() {
  prefer_bun
  if have bun && bun_new_enough "$(bun --version)"; then ok "bun $(bun --version)"; return; fi
  if [ "$DRY" = 1 ]; then if have bun; then plan "update Bun $(bun --version) to $BUN_MIN or newer"; else plan "install Bun"; fi; return; fi
  if have bun; then step "Updating Bun $(bun --version): Foundry needs $BUN_MIN or newer"; else step "Installing Bun"; fi
  if ! is_mac && ! have unzip; then pkg_install unzip || fail "Bun's installer needs unzip; install it and run this again"; fi
  fetch_run https://bun.sh/install bash >/dev/null || true
  # the fresh one goes first for this run; the service and the foundry command take its path
  prefer_bun
  have bun && bun_new_enough "$(bun --version)" || fail "Bun $BUN_MIN or newer did not install; see https://bun.sh (a Homebrew Bun: brew upgrade bun)"
  ok "bun $(bun --version)"
}

need_uv() {
  path_add "$HOME/.local/bin"
  if have uv; then ok "uv $(uv --version | awk '{print $2}')"; return; fi
  if [ "$DRY" = 1 ]; then plan "install uv"; return; fi
  step "Installing uv (for graphify and markitdown)"
  fetch_run https://astral.sh/uv/install.sh sh >/dev/null || true
  have uv || fail "uv did not install; see https://docs.astral.sh/uv/"
  ok "uv $(uv --version | awk '{print $2}')"
}

# the x.y.z a CLI reports: "2.1.309 (Claude Code)", "codex-cli 0.160.0", "1.4.5"
cli_version() { "$1" --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true; }
older() { # older 0.160.0 0.163.0 → 0 when the first version is the older one
  local a1 a2 a3 b1 b2 b3
  IFS=. read -r a1 a2 a3 <<<"$1"
  IFS=. read -r b1 b2 b3 <<<"$2"
  if [ "${a1:-0}" -ne "${b1:-0}" ]; then [ "${a1:-0}" -lt "${b1:-0}" ]
  elif [ "${a2:-0}" -ne "${b2:-0}" ]; then [ "${a2:-0}" -lt "${b2:-0}" ]
  else [ "${a3:-0}" -lt "${b3:-0}" ]; fi
}
# the newest release, empty when it cannot be looked up: an npm package's from the registry, agy's from the manifest
# Google's installer reads
npm_latest() { curl -fsSL --max-time 10 "https://registry.npmjs.org/$1/latest" 2>/dev/null | grep -Eo '"version": *"[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -Eo '[0-9.]+[0-9]' || true; }
agy_latest() {
  local os a
  is_mac && os=darwin || os=linux
  case "$(uname -m)" in x86_64|amd64) a=amd64 ;; arm64|aarch64) a=arm64 ;; *) return 0 ;; esac
  if [ "$os" = linux ] && ldd /bin/ls 2>&1 | grep -q musl; then a="${a}_musl"; fi
  curl -fsSL --max-time 10 "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${os}_$a.json" 2>/dev/null | grep -Eo '"version": *"[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | grep -Eo '[0-9.]+[0-9]' || true
}

# a coding agent's CLI that is already here, brought up to its newest release by update_<bin> when it is older
update_agent() { # update_agent bin label newest
  local cur now
  cur="$(cli_version "$1")"
  if [ -z "$3" ]; then ok "$2 $cur (could not check for a newer release)"; return 0; fi
  if ! older "$cur" "$3"; then ok "$2 $cur"; return 0; fi
  if [ "$DRY" = 1 ]; then plan "update $2 $cur to $3"; return 0; fi
  step "Updating $2 $cur to $3"
  if "update_$1" </dev/null >/dev/null 2>&1; then
    hash -r
    now="$(cli_version "$1")"
    if [ "$now" = "$cur" ]; then ok "$2 $cur (its updater has nothing newer yet)"; else ok "$2 $now"; fi
  else
    warn "$2 stays $cur: its update did not finish (try: $1 update)"
  fi
}
# each CLI's own updater knows how it was installed: native, Homebrew, npm or its standalone installer
update_claude() { claude update; }
# a release binary this installer unpacked is one Codex cannot place: it is unpacked again
update_codex() { codex update || { [ "$(command -v codex)" = "$BIN_DIR/codex" ] && codex_release; }; }
update_agy() { if have brew && brew list --cask antigravity-cli >/dev/null 2>&1; then brew upgrade --cask antigravity-cli; else agy update; fi; }

need_claude() {
  path_add "$HOME/.local/bin"
  if have claude; then update_agent claude "Claude Code" "$(npm_latest @anthropic-ai/claude-code)"; return; fi
  if [ "$DRY" = 1 ]; then plan "install Claude Code (native installer)"; return; fi
  step "Installing Claude Code"
  fetch_run https://claude.ai/install.sh bash || true
  have claude || fail "Claude Code did not install; see https://code.claude.com/docs/en/setup"
  ok "Claude Code installed"
}

need_codex() {
  if have codex; then update_agent codex Codex "$(npm_latest @openai/codex)"; return; fi
  if [ "$DRY" = 1 ]; then plan "install the Codex CLI"; return; fi
  step "Installing the Codex CLI"
  if is_mac && need_brew; then brew install --cask codex; else codex_release || true; fi
  have codex && ok "Codex $(cli_version codex)" || warn "Codex did not install; see https://github.com/openai/codex"
}
# the newest release binary, unpacked into ~/.local/bin
codex_release() {
  local a os
  case "$(uname -m)" in x86_64|amd64) a=x86_64 ;; arm64|aarch64) a=aarch64 ;; *) warn "no Codex binary for $(uname -m); see https://github.com/openai/codex"; return 1 ;; esac
  is_mac && os=apple-darwin || os=unknown-linux-musl
  mkdir -p "$BIN_DIR" && path_add "$BIN_DIR"
  fetch_tar "https://github.com/openai/codex/releases/latest/download/codex-$a-$os.tar.gz" "$BIN_DIR" && mv "$BIN_DIR/codex-$a-$os" "$BIN_DIR/codex"
}

# the Antigravity CLI through Google's installer, which puts agy in ~/.local/bin
need_agy() {
  path_add "$BIN_DIR"
  if have agy; then update_agent agy Antigravity "$(agy_latest)"; return; fi
  if [ "$DRY" = 1 ]; then plan "install the Antigravity CLI (agy)"; return; fi
  step "Installing the Antigravity CLI"
  fetch_run https://antigravity.google/cli/install.sh bash >/dev/null || true
  have agy && ok "Antigravity $(cli_version agy)" || warn "the Antigravity CLI did not install; see https://antigravity.google/docs/cli"
}

need_graphify() {
  if ! have graphify; then
    if [ "$DRY" = 1 ]; then plan "install graphify (uv tool)"; return; fi
    step "Installing graphify (Foundry's code-graph tool)"
    uv tool install graphifyy >/dev/null 2>&1 || uv tool install graphifyy
    have graphify || fail "graphify did not install; see https://github.com/safishamsi/graphify"
  fi
  [ "$DRY" = 1 ] && { ok "graphify"; return; }
  uses claude && graphify install --platform claude >/dev/null 2>&1 || true
  uses codex && graphify install --platform codex >/dev/null 2>&1 || true
  # Antigravity reads the ~/.agents/skills Codex reads: Codex's copy serves both
  uses agy && ! uses codex && graphify install --platform antigravity >/dev/null 2>&1 || true
  ok "graphify"
}

# GitHub CLI: Foundry pushes, opens and merges pull requests with it
need_gh() {
  if have gh; then ok "GitHub CLI $(gh --version | awk 'NR==1{print $3}')"; return; fi
  if [ "$DRY" = 1 ]; then plan "install the GitHub CLI"; return; fi
  step "Installing the GitHub CLI (pull requests)"
  if is_mac; then need_brew && brew install gh
  else
    # the release binary: no package repository or sudo needed on any distribution
    local v a
    v="$(curl -fsSL --retry 3 https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1 || true)"
    case "$(uname -m)" in x86_64|amd64) a=amd64 ;; arm64|aarch64) a=arm64 ;; *) warn "no GitHub CLI build for $(uname -m)"; return ;; esac
    [ -n "$v" ] || { warn "could not find the latest GitHub CLI release; install gh yourself"; return; }
    mkdir -p "$BIN_DIR" "$SHARE_DIR" && path_add "$BIN_DIR"
    fetch_tar "https://github.com/cli/cli/releases/download/v$v/gh_${v}_linux_$a.tar.gz" "$SHARE_DIR" && ln -sf "$SHARE_DIR/gh_${v}_linux_$a/bin/gh" "$BIN_DIR/gh"
  fi
  have gh && ok "GitHub CLI $(gh --version | awk 'NR==1{print $3}')" || warn "the GitHub CLI did not install; PR delivery needs it (https://cli.github.com)"
}

# Node.js: autoskills runs through npx, and previews of JavaScript projects need it; corepack brings pnpm and yarn
need_node() {
  path_add "$BIN_DIR"
  local major=0
  have node && major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -ge 18 ]; then ok "Node.js $(node --version)"
  elif [ "$DRY" = 1 ]; then plan "install Node.js 22"; return
  else
    step "Installing Node.js (autoskills and JavaScript previews)"
    if is_mac; then need_brew && brew install node
    elif ldd --version 2>&1 | grep -qi musl; then pkg_install nodejs npm || warn "could not install Node.js"
    else
      local file
      file="$(curl -fsSL --retry 3 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt 2>/dev/null | awk -v a="linux-$(arch).tar.gz" '$2 ~ a"$" {print $2; exit}' || true)"
      [ -n "$file" ] || fail "could not find a Node.js build for $(uname -m)"
      mkdir -p "$SHARE_DIR" "$BIN_DIR"
      rm -rf "$SHARE_DIR/node" && mkdir -p "$SHARE_DIR/node"
      fetch_tar "https://nodejs.org/dist/latest-v22.x/$file" "$SHARE_DIR/node" --strip-components 1 && for b in node npm npx corepack; do ln -sf "$SHARE_DIR/node/bin/$b" "$BIN_DIR/$b"; done
    fi
    have node || fail "Node.js did not install; see https://nodejs.org"
    ok "Node.js $(node --version)"
  fi
  have corepack || npm install -g corepack >/dev/null 2>&1 || true
  if have corepack; then corepack enable --install-directory "$BIN_DIR" >/dev/null 2>&1 || true; fi
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

need_markitdown() {
  have markitdown && { ok "markitdown"; return; }
  if [ "$DRY" = 1 ]; then plan "install markitdown (uv tool)"; return; fi
  uv tool install --python 3.12 'markitdown[all]' >/dev/null 2>&1 && ok "markitdown" || warn "markitdown did not install; the Setup page can try again"
}

need_chromium() {
  if [ "$DRY" = 1 ]; then plan "download Chromium for the self-check"; return; fi
  local cli="$DIR/packages/engine/node_modules/playwright/cli.js"
  [ -f "$cli" ] || { warn "Playwright is not in the build; install Chromium from Settings → Preview & self-check"; return; }
  # Linux needs Chromium's system libraries, which only root can add
  if ! is_mac; then sudo_cmd "$(command -v bun)" "$cli" install-deps chromium >/dev/null 2>&1 || warn "could not add Chromium's system libraries (needs sudo)"; fi
  (cd "$DIR" && bun "$cli" install chromium >/dev/null 2>&1) && ok "Chromium" || warn "Chromium did not download; Settings → Preview & self-check can try again"
}

need_ffmpeg() {
  have ffmpeg && { ok "ffmpeg"; return; }
  if [ "$DRY" = 1 ]; then plan "install ffmpeg"; return; fi
  pkg_install ffmpeg >/dev/null 2>&1 && ok "ffmpeg" || warn "ffmpeg did not install"
}

get_foundry() {
  if [ "$DRY" = 1 ]; then
    [ -d "$DIR/.git" ] && plan "update Foundry in $DIR and build it" || plan "download Foundry ($REF) into $DIR and build it"
    return
  fi
  if [ -d "$DIR/.git" ]; then
    step "Updating Foundry in $DIR"
    git -C "$DIR" fetch --quiet --tags origin
    git -C "$DIR" checkout --quiet "$REF"
    if git -C "$DIR" symbolic-ref -q HEAD >/dev/null; then git -C "$DIR" pull --quiet --ff-only; fi
  else
    [ -e "$DIR" ] && fail "$DIR exists and is not a Foundry checkout; pick another folder with --dir"
    step "Downloading Foundry into $DIR"
    git clone --quiet --branch "$REF" "$REPO" "$DIR"
  fi
  step "Building Foundry"
  (cd "$DIR" && bun install --frozen-lockfile >/dev/null 2>&1 && bun run web:build >/dev/null 2>&1) || fail "the build failed; see: cd $DIR && bun install && bun run web:build"
  ok "Foundry $(git -C "$DIR" describe --tags --always 2>/dev/null)"
}

sign_in_source() {
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

# what is still missing, as Foundry itself sees it
run_doctor() {
  [ "$DRY" = 1 ] && return 0
  step "Checking the machine (foundry doctor)"
  (cd "$DIR" && bun run cli doctor --provider "$(provider)") || warn "the list above says what is left; the Setup page can fix most of it"
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

# the launch profile: the first chosen agent, in the order Claude Code, Codex, Antigravity
provider() { if uses codex && ! uses claude; then echo codex; elif [ "$AGENT" = agy ]; then echo agy; else echo claude; fi; }

start_service() {
  if [ "$DRY" = 1 ]; then plan "run Foundry as a background service on port ${PORT:-4111} and open it"; return; fi
  local bun_bin log_dir
  bun_bin="$(command -v bun)"
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
  <key>ProgramArguments</key><array><string>$(xml "$bun_bin")</string><string>apps/cli/src/main.ts</string><string>serve</string></array>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
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
WorkingDirectory=$(unit_value "$DIR")
ExecStart=$(unit_value "$bun_bin") apps/cli/src/main.ts serve
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
    (cd "$DIR" && FOUNDRY_PORT="$PORT" FOUNDRY_PROVIDER="$(provider)" exec nohup "$bun_bin" apps/cli/src/main.ts serve </dev/null >>"$log_dir/foundry.log" 2>&1) &
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

# ---------- docker mode ----------

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

compose() { (cd "$DIR" && $DOCKER compose "$@"); }

install_docker() {
  have curl || fail "curl is needed"
  # a source checkout in the same folder keeps it; the container's files go beside it
  [ -d "$DIR/.git" ] && DIR="$DIR-docker"
  if uses agy; then
    [ "$AGENT" = agy ] && fail "the Docker image has no Antigravity CLI: run Foundry from source for it (--mode source)"
    warn "the Docker image has no Antigravity CLI; run Foundry from source for it"
    AGENT="$(agents_without agy)"
  fi
  step "Foundry in Docker — coding agents: ${AGENT//,/, }, folder: $DIR"
  ensure_docker
  if [ "$DRY" = 0 ] && ! $DOCKER compose version >/dev/null 2>&1; then
    fail "Docker Compose v2 (docker compose) is missing; install the compose plugin (https://docs.docker.com/compose/install/) and run this again"
  fi
  REPOS="$(ask "  Your projects folder (shared with Foundry) [$REPOS]: " "$REPOS")"
  REPOS="${REPOS/#\~/$HOME}"
  [ -d "$REPOS" ] || { [ "$DRY" = 1 ] && plan "create $REPOS" || mkdir -p "$REPOS"; }
  if [ -z "$HOST_DOCKER" ]; then
    note "Foundry can start the databases and other services your previews need on this computer's Docker."
    note "That shares the Docker socket with the Foundry container, which is root-level access to this computer"
    note "for Foundry and the AI sessions it runs (ADR-0024)."
    yesno "Share this computer's Docker with Foundry?" y && HOST_DOCKER=1 || HOST_DOCKER=0
  fi
  pick_port
  choose_memory
  if [ "$DRY" = 1 ]; then
    plan "pull $IMAGE:latest, write $DIR/docker-compose.yml, .env and docker-compose.override.yml"
    plan "share $REPOS (at the same path and at /repos), ~/.gitconfig$([ -f "$HOME/.config/gh/hosts.yml" ] && echo ', your GitHub CLI sign-in')$([ "$HOST_DOCKER" = 1 ] && echo ", this computer's Docker")"
    [ "$MEMORY" = 1 ] && plan "run a Hindsight server for Memory beside Foundry (compose profile memory, LLM provider $HINDSIGHT_PROVIDER$([ -n "$HINDSIGHT_KEY" ] && echo ' with the key given' || echo ', no key yet'); its key goes to $DIR/hindsight.env)"
    plan "start it on port $PORT and offer to sign in inside the container"
    return
  fi
  mkdir -p "$DIR"
  step "Pulling $IMAGE"
  # an image built here (FOUNDRY_IMAGE) is used as it is
  $DOCKER pull -q "$IMAGE:latest" >/dev/null 2>&1 || $DOCKER image inspect "$IMAGE:latest" >/dev/null 2>&1 || fail "could not pull $IMAGE:latest"
  $DOCKER run --rm --entrypoint cat "$IMAGE:latest" /app/docker-compose.yml >"$DIR/docker-compose.yml"
  write_docker_env
  write_docker_override
  write_hindsight_env
  step "Starting Foundry"
  compose up -d >/dev/null
  wait_healthy
  sign_in_docker
}

write_docker_env() {
  local token
  token="$(grep -s '^FOUNDRY_WATCHTOWER_TOKEN=' "$DIR/.env" | cut -d= -f2- || true)"
  [ -n "$token" ] || token="$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom 2>/dev/null | head -c 32 || true)"
  cat >"$DIR/.env" <<EOF
# written by the Foundry installer
FOUNDRY_REPOS=$REPOS
FOUNDRY_PROVIDER=$(provider)
FOUNDRY_PORT=$PORT
FOUNDRY_WATCHTOWER_TOKEN=$token
EOF
  # Memory (ADR-0072): the compose profile that starts the Hindsight service, and where Foundry finds it
  [ "$MEMORY" = 1 ] && cat >>"$DIR/.env" <<EOF
COMPOSE_PROFILES=memory
HINDSIGHT_API_URL=http://hindsight:8888
EOF
  return 0
}

# docker: a Hindsight server for Memory (ADR-0072), chosen with --with hindsight or asked once; its LLM is the person's
choose_memory() {
  case " $WITH " in *" hindsight "*) MEMORY=1 ;; esac
  if [ -z "$MEMORY" ]; then
    if [ -z "$TTY" ] || [ "$YES" = 1 ]; then MEMORY=0
    else
      note "Memory: a Hindsight server beside Foundry remembers what each folder's goals did and taught, and every"
      note "stage asks it first. It needs 1.5–2 GB of memory, a 3.7–9 GB image, and an LLM key of yours."
      yesno "Run a Hindsight server for Memory?" n && MEMORY=1 || MEMORY=0
    fi
  fi
  [ "$MEMORY" = 1 ] || return 0
  HINDSIGHT_PROVIDER="${HINDSIGHT_API_LLM_PROVIDER:-${HINDSIGHT_PROVIDER:-openai}}"
  HINDSIGHT_MODEL="${HINDSIGHT_API_LLM_MODEL:-$HINDSIGHT_MODEL}"
  HINDSIGHT_KEY="${HINDSIGHT_API_LLM_API_KEY:-}"
  # a key given before stays unless a new one is typed
  [ -n "$HINDSIGHT_KEY" ] || HINDSIGHT_KEY="$(grep -s '^HINDSIGHT_API_LLM_API_KEY=' "$DIR/hindsight.env" | cut -d= -f2- || true)"
  if [ -n "$TTY" ] && [ "$YES" = 0 ]; then
    HINDSIGHT_PROVIDER="$(ask "  Hindsight's LLM provider (openai, anthropic, gemini, groq, openrouter …) [$HINDSIGHT_PROVIDER]: " "$HINDSIGHT_PROVIDER")"
    HINDSIGHT_KEY="$(ask_secret "  Its API key$([ -n "$HINDSIGHT_KEY" ] && echo ' (Enter keeps the saved one)'): " "$HINDSIGHT_KEY")"
    HINDSIGHT_MODEL="$(ask "  Its model (Enter for the provider's default)$([ -n "$HINDSIGHT_MODEL" ] && echo " [$HINDSIGHT_MODEL]"): " "$HINDSIGHT_MODEL")"
  fi
  [ -n "$HINDSIGHT_KEY" ] || warn "no LLM key for Hindsight: the server starts, but extracts and answers nothing until HINDSIGHT_API_LLM_API_KEY is set in $DIR/hindsight.env"
  return 0
}

# the Hindsight service's own variables, in a file of their own (mode 600): the compose file reads it when it exists
write_hindsight_env() {
  [ "$MEMORY" = 1 ] || return 0
  {
    echo "# written by the Foundry installer: the LLM Hindsight extracts and answers with (ADR-0072)"
    echo "HINDSIGHT_API_LLM_PROVIDER=$HINDSIGHT_PROVIDER"
    echo "HINDSIGHT_API_LLM_API_KEY=$HINDSIGHT_KEY"
    [ -n "$HINDSIGHT_MODEL" ] && echo "HINDSIGHT_API_LLM_MODEL=$HINDSIGHT_MODEL"
  } >"$DIR/hindsight.env"
  chmod 600 "$DIR/hindsight.env"
  return 0
}

write_docker_override() {
  local f="$DIR/docker-compose.override.yml" gid=""
  {
    echo "# written by the Foundry installer; run it again to change these (ADR-0024)"
    echo "services:"
    echo "  foundry:"
    # an image other than the published one (FOUNDRY_IMAGE, such as one built here)
    [ "$IMAGE" != imlouiskhenghao/foundry ] && echo "    image: $IMAGE:latest"
    echo "    ports: !override"
    echo "      - '127.0.0.1:$PORT:4111'"
    echo "      - '127.0.0.1:${FOUNDRY_PREVIEW_PORTS:-4200-4299}:${FOUNDRY_PREVIEW_PORTS:-4200-4299}'"
    echo "    volumes:"
    # the same path as on this computer, so bind mounts and goal paths mean the same inside and out; /repos stays
    echo "      - '$REPOS:$REPOS'"
    [ -f "$HOME/.gitconfig" ] && echo "      - '$HOME/.gitconfig:/home/node/.gitconfig:ro'"
    # a GitHub CLI sign-in kept in a file (not the macOS keychain) works inside as well
    grep -qs 'oauth_token' "$HOME/.config/gh/hosts.yml" && echo "      - '$HOME/.config/gh:/home/node/.config/gh'"
    if [ "$HOST_DOCKER" = 1 ]; then
      echo "      - '/var/run/docker.sock:/var/run/docker.sock'"
      gid="$($DOCKER run --rm -v /var/run/docker.sock:/s --entrypoint stat "$IMAGE:latest" -c %g /s 2>/dev/null || echo 0)"
      echo "    group_add:"
      echo "      - '$gid'"
    fi
    echo "    environment:"
    echo "      FOUNDRY_HOST_REPOS: '$REPOS'"
    [ "$HOST_DOCKER" = 1 ] && { echo "      FOUNDRY_HOST_DOCKER: '1'"; echo "      FOUNDRY_CONTAINER: foundry"; }
  } >"$f"
  return 0
}

sign_in_docker() {
  [ -z "$TTY" ] && return 0
  step "Signing in inside the container (Enter on a question skips it; the Setup page can do it later)"
  local it="$DOCKER exec -it foundry"
  if uses claude && ! $DOCKER exec foundry claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
    if yesno "Sign in to Claude Code now?" y; then $it claude auth login <"$TTY" >"$TTY" 2>&1 || warn "Claude Code sign-in did not finish"; fi
  fi
  if uses codex && ! $DOCKER exec foundry codex login status >/dev/null 2>&1; then
    if yesno "Sign in to Codex now?" y; then $it codex login --device-auth <"$TTY" >"$TTY" 2>&1 || warn "Codex sign-in did not finish"; fi
  fi
  if ! $DOCKER exec foundry gh auth status >/dev/null 2>&1; then
    if yesno "Sign in to GitHub now (for pull requests)?" y; then $it gh auth login --web --git-protocol https <"$TTY" >"$TTY" 2>&1 || warn "GitHub sign-in did not finish"; fi
  fi
  return 0
}

# ---------- the foundry command, PATH, the end ----------

install_command() {
  if [ "$DRY" = 1 ]; then plan "add the foundry command to $BIN_DIR"; return; fi
  mkdir -p "$SHARE_DIR" "$BIN_DIR"
  local self="${BASH_SOURCE[0]:-}"
  # run through `curl | bash` there is no file: fetch the same script for the command to use
  if [ -n "$self" ] && [ -f "$self" ]; then cp "$self" "$SHARE_DIR/install.sh.new"; else curl -fsSL "$RAW_URL" -o "$SHARE_DIR/install.sh.new"; fi
  mv "$SHARE_DIR/install.sh.new" "$SHARE_DIR/install.sh"
  cat >"$BIN_DIR/foundry" <<EOF
#!/usr/bin/env bash
# Foundry's own command (written by its installer): foundry start | stop | restart | status | logs | open | update | uninstall
exec bash "$SHARE_DIR/install.sh" "\${@:-status}"
EOF
  chmod +x "$BIN_DIR/foundry"
}

modify_path() {
  local need="" dir
  for dir in "$BIN_DIR" "$HOME/.bun/bin"; do
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
  if [ "$START" = 1 ] && healthy "$PORT"; then
    printf '  Open:     http://127.0.0.1:%s\n' "$PORT"
    open_browser
  else
    printf '  Start it: foundry start\n'
  fi
  printf '  Manage:   foundry status | logs | stop | start | update | uninstall\n\n'
}

# ---------- foundry <command> ----------

control() {
  case "$1" in
    start)
      if [ "$MODE" = docker ]; then compose up -d; PORT="${PORT:-4111}"; wait_healthy
      else pick_port; start_service; save_state; fi ;;
    stop)
      if [ "$MODE" = docker ]; then compose stop foundry
      elif [ "$SERVICE" = launchd ]; then launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      elif [ "$SERVICE" = systemd ]; then systemctl --user stop foundry.service
      else process_stop; fi
      ok "Foundry stopped" ;;
    restart) control stop; control start ;;
    status)
      printf 'Foundry (%s) in %s, port %s: ' "$MODE" "$DIR" "${PORT:-4111}"
      healthy "${PORT:-4111}" && printf '\033[32mrunning\033[0m — http://127.0.0.1:%s\n' "${PORT:-4111}" || printf '\033[33mnot answering\033[0m (foundry start, foundry logs)\n' ;;
    logs)
      if [ "$MODE" = docker ]; then compose logs -f --tail 200 foundry
      elif [ "$SERVICE" = systemd ]; then journalctl --user -u foundry.service -f -n 200
      else tail -n 200 -f "$([ "$(uname -s)" = Darwin ] && echo "$HOME/Library/Logs/Foundry" || echo "$SHARE_DIR/logs")/foundry.log"; fi ;;
    open) PORT="${PORT:-4111}"; open_browser; printf 'http://127.0.0.1:%s\n' "$PORT" ;;
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
  if [ "$MODE" = docker ]; then
    if [ "$PURGE" = 1 ] && yesno "Delete Foundry's data too (goal history, settings, sign-ins in the container)? This cannot be undone." n; then compose down -v; rm -rf "$DIR"; else compose down; fi
  else
    control stop >/dev/null 2>&1 || true
    rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ "$SERVICE" = systemd ]; then systemctl --user disable foundry.service >/dev/null 2>&1 || true; rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/foundry.service"; systemctl --user daemon-reload || true; fi
    if [ "$PURGE" = 1 ] && yesno "Delete $DIR, with Foundry's data (goal history, settings)? Your repositories are not touched." n; then rm -rf "$DIR"; fi
  fi
  # the Node.js and GitHub CLI the installer put in $SHARE_DIR stay: other tools use them
  rm -f "$BIN_DIR/foundry" "$STATE" "$SHARE_DIR/install.sh" "$SHARE_DIR/foundry.pid"
  local rc
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$rc" ] && grep -q '# >>> foundry >>>' "$rc" && sed -i.bak '/# >>> foundry >>>/,/# <<< foundry <<</d' "$rc" && rm -f "$rc.bak"
  done
  rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/foundry.fish"
  local kept="in $DIR"
  [ "$MODE" = docker ] && kept="in its Docker volumes"
  ok "Foundry is removed$([ "$PURGE" = 1 ] || echo "; its data stays $kept (foundry uninstall --purge deletes it)"). Bun, gh, Docker and the other tools stay installed."
}

main "$@"
