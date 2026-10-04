#!/usr/bin/env bash
# Foundry one-line install for macOS and Linux:
#
#   curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash -s -- --agent codex
#
# Installs what is missing, and only that: git, Bun, uv, graphify, the coding agent's CLI (Claude Code through its
# native installer, Codex through Homebrew, npm or its release binary), then Foundry itself, built and checked by its
# doctor. Neither coding agent needs Node.js or npm. Options (or the environment variables in brackets):
#
#   --agent claude|codex|both   which coding agent to set up               [FOUNDRY_AGENT, default claude]
#   --dir PATH                  where Foundry goes                         [FOUNDRY_DIR, default ~/foundry]
#   --ref BRANCH|TAG            what to check out                          [FOUNDRY_REF, default main]
#   --start                     start Foundry when done                    [FOUNDRY_START=1]
#
# Safe to run again: it updates an existing checkout and skips everything already installed.
set -euo pipefail

main() {
  local agent="${FOUNDRY_AGENT:-claude}" dir="${FOUNDRY_DIR:-$HOME/foundry}" ref="${FOUNDRY_REF:-main}"
  local repo="${FOUNDRY_REPO:-https://github.com/louiskhenghao/Foundry.git}" start="${FOUNDRY_START:-0}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent) agent="$2"; shift 2 ;;
      --dir) dir="$2"; shift 2 ;;
      --ref) ref="$2"; shift 2 ;;
      --start) start=1; shift ;;
      -h|--help) sed -n '2,17p' "$0" 2>/dev/null || true; return 0 ;;
      *) fail "unknown option $1 (see --help)" ;;
    esac
  done
  case "$agent" in claude|codex|both) ;; *) fail "--agent must be claude, codex or both" ;; esac
  case "$(uname -s)" in Darwin|Linux) ;; *) fail "Foundry runs on macOS and Linux; on Windows use WSL or the Docker image" ;; esac
  have curl || fail "curl is needed"

  step "Foundry install — coding agent: $agent, folder: $dir"
  need_git
  need_bun
  need_uv
  [ "$agent" = codex ] || need_claude
  [ "$agent" = claude ] || need_codex
  need_graphify "$agent"
  get_foundry "$repo" "$ref" "$dir"

  step "Checking the machine (bun run cli doctor)"
  local provider=claude
  [ "$agent" = codex ] && provider=codex
  (cd "$dir" && bun run cli doctor --provider "$provider") || warn "the doctor lists what is left; signing in is usually all"

  local serve="bun run serve"
  [ "$agent" = codex ] && serve="bun run serve:codex"
  printf '\n\033[1mFoundry is installed in %s.\033[0m\n\n' "$dir"
  [ "$agent" = codex ] || printf '  Sign in to Claude Code:  claude auth login   (or Sign in on the Setup page)\n'
  [ "$agent" = claude ] || printf '  Sign in to Codex:        codex login         (or Sign in on the Setup page)\n'
  printf '  Start Foundry:           cd %s && %s\n' "$dir" "$serve"
  printf '  Then open:               http://127.0.0.1:4111\n\n'
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) [ -d "$HOME/.local/bin" ] && printf '  New terminals need ~/.local/bin on PATH (claude, uv, graphify live there):\n    echo '\''export PATH="$HOME/.local/bin:$PATH"'\'' >> ~/.%src\n\n' "$(basename "${SHELL:-bash}")" ;; esac
  if [ "$start" = 1 ]; then cd "$dir" && exec $serve; fi
}

have() { command -v "$1" >/dev/null 2>&1; }
step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }
path_add() { case ":$PATH:" in *":$1:"*) ;; *) export PATH="$1:$PATH" ;; esac; }

# a system package through whatever the machine has; sudo only when not root, and it asks on the terminal
pkg_install() {
  local sudo=""
  [ "$(id -u)" = 0 ] || { have sudo && sudo="sudo"; }
  if [ "$(uname -s)" = Darwin ]; then
    have brew || return 1
    brew install "$@"
  elif have apt-get; then $sudo apt-get update -qq && $sudo apt-get install -y -qq "$@"
  elif have dnf; then $sudo dnf install -y -q "$@"
  elif have yum; then $sudo yum install -y -q "$@"
  elif have pacman; then $sudo pacman -S --noconfirm --needed "$@"
  elif have apk; then $sudo apk add --no-cache "$@"
  else return 1
  fi
}

need_git() {
  if have git; then ok "git $(git --version | awk '{print $3}')"; return; fi
  step "Installing git"
  if [ "$(uname -s)" = Darwin ] && ! have brew; then
    xcode-select --install 2>/dev/null || true
    fail "git comes with Apple's command line tools: finish the dialog that just opened, then run this again"
  fi
  pkg_install git || fail "could not install git; install it and run this again"
  ok "git installed"
}

need_bun() {
  path_add "$HOME/.bun/bin"
  if have bun; then ok "bun $(bun --version)"; return; fi
  step "Installing Bun"
  # Bun's installer unpacks a zip
  if [ "$(uname -s)" = Linux ] && ! have unzip; then pkg_install unzip || fail "Bun's installer needs unzip; install it and run this again"; fi
  curl -fsSL https://bun.sh/install | bash >/dev/null
  have bun || fail "Bun did not install; see https://bun.sh"
  ok "bun $(bun --version)"
}

need_uv() {
  path_add "$HOME/.local/bin"
  if have uv; then ok "uv $(uv --version | awk '{print $2}')"; return; fi
  step "Installing uv (for graphify)"
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null
  have uv || fail "uv did not install; see https://docs.astral.sh/uv/"
  ok "uv $(uv --version | awk '{print $2}')"
}

need_claude() {
  path_add "$HOME/.local/bin"
  if have claude; then ok "Claude Code $(claude --version 2>/dev/null | awk '{print $1}')"; return; fi
  step "Installing Claude Code (native installer, no npm needed)"
  curl -fsSL https://claude.ai/install.sh | bash
  have claude || fail "Claude Code did not install; see https://code.claude.com/docs/en/setup"
  ok "Claude Code installed"
}

need_codex() {
  if have codex; then ok "Codex $(codex --version 2>/dev/null | awk '{print $NF}')"; return; fi
  step "Installing the Codex CLI"
  if [ "$(uname -s)" = Darwin ] && have brew; then brew install --cask codex
  elif have npm; then npm install -g @openai/codex
  else
    # no Homebrew or npm: Codex's own release binary into ~/.local/bin
    local arch os
    case "$(uname -m)" in x86_64|amd64) arch=x86_64 ;; arm64|aarch64) arch=aarch64 ;; *) warn "no Codex binary for $(uname -m); see https://github.com/openai/codex"; return ;; esac
    [ "$(uname -s)" = Darwin ] && os=apple-darwin || os=unknown-linux-musl
    mkdir -p "$HOME/.local/bin" && path_add "$HOME/.local/bin"
    curl -fsSL "https://github.com/openai/codex/releases/latest/download/codex-$arch-$os.tar.gz" | tar -xz -C "$HOME/.local/bin"
    mv "$HOME/.local/bin/codex-$arch-$os" "$HOME/.local/bin/codex"
  fi
  have codex && ok "Codex $(codex --version 2>/dev/null | awk '{print $NF}')" || warn "Codex did not install; see https://github.com/openai/codex"
}

need_graphify() {
  if ! have graphify; then
    step "Installing graphify (Foundry's code-graph tool)"
    uv tool install graphifyy >/dev/null 2>&1 || uv tool install graphifyy
    have graphify || fail "graphify did not install; see https://github.com/safishamsi/graphify"
  fi
  # its skill, once per coding agent
  [ "$1" = codex ] || graphify install --platform claude >/dev/null
  [ "$1" = claude ] || graphify install --platform codex >/dev/null
  ok "graphify"
}

get_foundry() {
  local repo="$1" ref="$2" dir="$3"
  if [ -d "$dir/.git" ]; then
    step "Updating Foundry in $dir"
    git -C "$dir" fetch --quiet --tags origin
    git -C "$dir" checkout --quiet "$ref"
    git -C "$dir" symbolic-ref -q HEAD >/dev/null && git -C "$dir" pull --quiet --ff-only
  else
    [ -e "$dir" ] && fail "$dir exists and is not a Foundry checkout; pick another folder with --dir"
    step "Downloading Foundry into $dir"
    git clone --quiet --branch "$ref" "$repo" "$dir"
  fi
  step "Building Foundry"
  (cd "$dir" && bun install --frozen-lockfile >/dev/null 2>&1 && bun run web:build >/dev/null 2>&1) || fail "the build failed; see: cd $dir && bun install && bun run web:build"
  ok "Foundry $(cd "$dir" && git describe --tags --always 2>/dev/null)"
}

main "$@"
