# Contributing to Foundry

Start with [docs/develop/](docs/develop/index.md): the architecture, the roles, testing and releasing. The glossary is
[CONTEXT.md](CONTEXT.md) — use its words in code, docs and commit messages.

## Every change

- **Small, focused commits** in [Conventional Commits](https://www.conventionalcommits.org/) form. The message says what
  changed and why, in one short paragraph.
- **No attribution lines.** No `Co-Authored-By`, no "generated with" footers, in commits or pull requests.
- **Tests and types pass:** `bun test packages` and `bun run typecheck`, both from the repository root.
- **Check the blast radius** before editing a function or class if you have GitNexus installed (`gitnexus impact <name>`).

## Documentation is part of the change

The docs have three audiences, in three folders:

| Folder | Reader | Languages |
|---|---|---|
| [docs/guide/](docs/guide/) | people who use Foundry through the web UI | English + 中文 |
| [docs/operate/](docs/operate/index.md) | whoever installs, configures and updates Foundry | English |
| [docs/develop/](docs/develop/index.md) | people who change Foundry's code | English |

In the same pull request as the code:

1. **Anything a user can see changed** (a screen, a button, a setting, a notice, a default) → update the page in
   `docs/guide/` that describes it, **and its `.zh.md` twin**. Button and setting names are quoted exactly as the UI shows
   them. If the screen appears in a screenshot, run `bun scripts/screenshots.ts` (free: it uses a scripted demo, no
   model calls).
2. **A setting, environment variable or CLI command changed** → describe it in
   `packages/engine/src/docs/settings-reference.ts` (settings) or `apps/cli/src/help.ts` (CLI), then run
   `bun scripts/gen-docs.ts`. The tests fail if `docs/operate/configuration.md` or `cli.md` is out of date, or if a
   setting has no description.
3. **A new domain word, or a word whose meaning changed** → [CONTEXT.md](CONTEXT.md). It is a glossary: meanings, not
   implementation.
4. **A decision that is hard to reverse, surprising without context, and the result of a real trade-off** → a new ADR in
   [docs/develop/adr/](docs/develop/adr/index.md). Never rewrite an old ADR; mark it amended or superseded.

## Trying a change in the real UI

Never test against an instance that is running real goals: a `bun --watch` server reloads on every file change and can
cut sessions in half. Use a separate git worktree with its own `data/` and port — see
[testing](docs/develop/testing.md).
