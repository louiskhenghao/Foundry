# Foundry

> English · [中文](./README.zh.md)

Foundry turns a goal written in plain words — *"add CSV export to the orders page"*, *"a landing page for our studio"*,
*"posters for the new drink"* — into finished, reviewed work in your repository. It runs on your own computer and drives
your Claude Code: it asks what only you can decide, shows you the plan once, then builds, checks, reviews and delivers on
its own, and stops only when it genuinely needs you.

- **Asks before it plans.** A short interview settles what the repository can't; you approve one Brief.
- **You see it before it's done.** At milestones the goal pauses, starts a live preview and waits for your look.
- **Checked, not guessed.** Every task has acceptance checks; the result is reviewed as a whole before it's handed over.
- **Your work, your folder.** Progress lives next to your repository in `<repo>-foundry/`; pushing and pull requests
  follow the policy you choose.
- **You control the spend.** Model presets decide which model does each job; budgets stop a goal before it overspends.

## Quick start

You need [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code) signed in (`claude` on your
PATH), and git. Docker works too — see [Install](docs/operate/install.md).

```bash
bun install && bun run web:build
bun run serve                 # then open http://127.0.0.1:4111
```

Open the UI, press **New goal**, point it at a repository and describe what you want.

## Where to go next

| I want to… | Read |
|---|---|
| **use Foundry** — create goals, read the Brief, answer the interview, handle the Inbox | [User guide](docs/guide/) |
| **install and run it** — Docker, remote access, notifications, updates, every setting | [Operator docs](docs/operate/index.md) |
| **change its code** — architecture, roles, testing, releasing, design decisions | [Contributor docs](docs/develop/index.md) · [CONTRIBUTING](CONTRIBUTING.md) |

Words Foundry uses (Goal, Brief, Milestone, Model Preset …) are defined in the [glossary](CONTEXT.md).
