# Operating Foundry

This track is for the person who installs Foundry, keeps it running, configures it, updates it and fixes it when
something goes wrong. You work with terminals, Docker and config files, but you do not change Foundry's code.

Foundry is a local orchestrator. It drives the Claude Code CLI on one machine to plan and deliver goals in your
repositories. The web UI runs on `http://127.0.0.1:4111`. You can run it from source with Bun, or in Docker
(image `imlouiskhenghao/foundry`). These pages describe the current release; the changelog lists what each version changed.

## Pages

| Page | What it covers |
|---|---|
| [install.md](./install.md) | Requirements, installing locally or with Docker, signing in to Claude, mounting repositories, first-run checks. |
| [updates-and-backup.md](./updates-and-backup.md) | Where Foundry keeps its data, backup and restore, self-update, release channel. |
| [remote-access.md](./remote-access.md) | Using Foundry from your phone or laptop over Tailscale, and keeping the machine running while you are away. |
| [notifications.md](./notifications.md) | Setting up Telegram and Discord messages. |
| [troubleshooting.md](./troubleshooting.md) | Doctor checks, common Docker problems, engine log lines, restarting safely, image-generation keys. |
| [configuration.md](./configuration.md) | Every setting and the environment variable that seeds it (generated from the code). |
| [cli.md](./cli.md) | Every `foundry` CLI command (generated from the code). |

## Other tracks

- **Using Foundry** (creating goals, answering questions, reading the Inbox, what each setting means for your goals):
  [docs/guide/](../guide/).
- **Changing Foundry's code** (architecture, design decisions, development setup): [docs/develop/](../develop/).
  The design decisions (ADRs) are in [docs/develop/adr/](../develop/adr/).

## Ground rules

- The web UI has no login. Keep it on `127.0.0.1`. To reach it from elsewhere, use [remote-access.md](./remote-access.md).
- Foundry uses your Claude subscription through the Claude Code CLI. It never needs an Anthropic API key, and it
  removes `ANTHROPIC_API_KEY` from every session it starts.
- Settings live in `data/settings.json`. For each value, a saved setting wins over an environment variable, and an
  environment variable wins over the default. The Settings page shows where each value comes from.
