# Operating Foundry

This track is for the person who installs Foundry, keeps it running, configures it, updates it and fixes it when
something goes wrong. You work with terminals, Docker and config files, but you do not change Foundry's code.

Foundry is a local orchestrator. It drives the Claude Code and Codex CLIs on one machine to plan and deliver goals in your
repositories. The web UI runs on `http://127.0.0.1:4111`. You can run it from source with Bun, or in Docker
(image `imlouiskhenghao/foundry`). These pages describe this source revision; what each published release contains is in the [changelog](https://github.com/louiskhenghao/foundry-releases/blob/main/CHANGELOG.md).

## Pages

| Page | What it covers |
|---|---|
| [install.md](./install.md) | Requirements, installing locally or with Docker, signing in to each backend, mounting repositories, first-run checks. |
| [codex.md](./codex.md) | ChatGPT-only sign-in, independent model presets, native extensions, quota windows and capability limits. |
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

- The web UI has no login. Keep it on `127.0.0.1`. To reach it from elsewhere, use [remote-access.md](./remote-access.md). Changes that a page on another website makes your browser send (a request marked cross-site, or with another site's Origin) are refused, so a web page you visit cannot drive Foundry; tools without a browser, such as `curl`, are not affected. Foundry also answers only to names of this computer (IP addresses, `localhost`, names without a dot or ending in `.local`, `*.ts.net`, and the Link base URL's host), so a page cannot point its own domain at `127.0.0.1` to read it (DNS rebinding). Another name, such as a tunnel's domain, goes in `FOUNDRY_ALLOWED_HOSTS`.
- Agent execution uses native accounts: Claude login or ChatGPT sign-in for Codex. Codex API-key inference is unsupported. Optional media services have separate credentials; they do not change the execution backend.
- Settings live in the instance’s data directory: `data/settings.json` for the default Claude launch profile, `data-codex/settings.json` for the Codex profile, or under `FOUNDRY_DATA_DIR`. For each value, a saved setting wins over an environment variable, and an
  environment variable wins over the default. The Settings page shows where each value comes from.
