# ADR-0110: Foundry brings the coding agents' CLIs up to their newest release

**Status:** accepted · 2026-11-20 · builds on ADR-0105 and ADR-0108

## Context

Until 3.0 the installer, and so `foundry update`, compared each chosen coding agent's CLI with its newest release and
ran the CLI's own updater when it was older. ADR-0108 cut the installer down to placing the app or the binary, and
ADR-0105 moved the recipes for the tools Foundry needs into Foundry itself, but only to install what is missing: a CLI
already on the computer stayed at whatever version it had. New models come with new CLI releases (Fable 5.2 needs
Claude Code 2.1.321), and Settings' **Sync models** can only find the ids the installed binary knows, so a computer
whose Claude Code was older never offered Fable 5.2, and nothing in Foundry said why.

Claude Code publishes two channels: `latest` and `stable`, which trails it by weeks (on 2026-11-20 `latest` was 2.1.329
and `stable` 2.1.311). `claude update` follows the channel the install follows, so on a `stable` install it never
reaches a release that brings a new model.

## Decision

- **The newest release** of each CLI is looked up where its own updater looks: Claude Code's `latest` channel
  (`downloads.claude.ai/claude-code-releases/latest`, the npm registry as a fallback), the npm registry for Codex,
  and the manifest Google's installer reads for Antigravity. The engine asks at most once an hour (again after five
  minutes when nobody answered), and never in a test run.
- **The updater fits how the CLI was installed** (its binary's resolved path): a Homebrew cask is upgraded with the
  brew that owns it; an npm install through npm at `@latest`; Claude Code's native install with `claude install
  latest`, which reaches `latest` whatever channel the install follows; the Codex release binary Setup unpacked into
  `~/.local/bin` is unpacked again (`codex update` cannot place it); anything else by the CLI's own `update`.
- **Where it shows.** The Setup page has a *&lt;CLI&gt; version* check: green with the newest release, yellow with
  **Update** when a newer one is out, green with a note when the newest could not be looked up. Settings → Models &
  limits puts the same Update under **Sync models** for Claude Code, Codex and Antigravity, since that is where a
  missing model is noticed. Both run `POST /api/tools/install` with the CLI's id: an installed CLI is updated, a
  missing one installed as before. `foundry setup` updates a CLI that was already there and is older; one it has just
  installed is not asked again, and a failed update does not fail setup.
- **After an update that moved the version** the engine syncs that coding agent's models, as Sync models does (for
  Claude Code, one tiny session per family alias). Sessions already running keep the binary they started with.

## Consequences

- A newer CLI release turns a Setup line yellow, not red: the CLI still works, and an update stays the person's call.
- On a native Claude Code install that followed `stable`, Update moves it to the newest `latest` release; its own
  auto-updates then follow its channel again.
- `GET /api/agent-cli?provider=` reports the installed version, the newest, whether it is outdated and the command
  Update runs.
