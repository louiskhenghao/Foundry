# ADR-0029: VS Code in the browser, behind a generated password, on loopback and the tailnet

**Status:** accepted · 2026-10-08

## Context

People follow goals from their phone (notifications, the tailnet links of ADR-0026), but the Open menu only launched
desktop apps on the computer running Foundry. Reading a goal's code on a phone meant going back to the computer.

## Decision

- **Open ▾ → VS Code (web)** opens a place (the checkout, the goal's folder, a task or resolve worktree) in code-server,
  VS Code in the browser. Foundry starts it on first use and stops it after two idle hours or with the engine.
- It listens on 127.0.0.1 only, behind a password Foundry generates once (kept in the data folder, readable by the
  user only; the Open menu shows it to copy). The editor has a terminal, so without one any tailnet peer, or a web page
  rebinding its own name to 127.0.0.1, would get a shell. Other devices reach it through the person's tailnet
  (`tailscale serve`, HTTPS, tailnet members only), taken down when it stops.
- Its processes get only the basics of Foundry's environment (home, path, user, shell, locale), none of its keys.
- Workspace trust stays on: a folder an agent wrote opens restricted until the person trusts it, so a task file in it
  cannot run on open.
- It is installed once, from Settings → Tools & keys, with code-server's standalone installer into `~/.local` (no
  root). Not in the Docker image for now.
- It can edit. While a goal runs, the menu warns that edits in its folders can clash with the agents' and ride along
  in their next commit.

## Consequences

- The person signs in once per browser with the password.
- The editor's settings and extensions live under the data folder (`code-server/`), apart from the person's own VS Code.
