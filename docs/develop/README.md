# Developing Foundry

This track is for people who change Foundry's own code: the engine, the server, the web UI, the CLI, the role prompts and the release tooling. If you only *use* Foundry, start with the [user guide](../guide/) instead. If you run it for other people (install, configuration, remote access, notifications), read the [operator docs](../operate/).

## Reading order

1. **[CONTEXT.md](../../CONTEXT.md)**, the glossary. Goal, Brief, Task, Attempt, Continuation, Check, Escalation, Milestone, Model Preset and the rest mean exactly what it says, in code, in the UI and in these pages. Read it before anything else.
2. **[Architecture](architecture.md)**: the packages and what each owns, the event log, the engine tick, the life of a goal from draft to delivery, how a session is started and which model it gets, workspaces, the server and web UI. It ends with a "where does X live" table.
3. **[Roles](roles.md)**: what each prompt in `roles/*.md` drives, which session loads it, which Model Preset row picks its model, what it gets as input and what it must return. Also how skill hints are put into prompts.
4. **[Testing](testing.md)**: running the suite and the typechecker, the fake runners the tests are built on, a known flake, and how to do manual QA against a throwaway server without touching your live instance.
5. **[Releasing](release.md)**: `bun run release`, the order it does things in, the prerequisites, and how to resume after a failed image push.
6. **[Architecture decision records](adr/)**: why things are the way they are. [adr/README.md](adr/) lists them with their status. Read an ADR before you change the decision it records.

## Getting a working tree

```sh
bun install
bun run dev          # engine under bun --watch + `vite build --watch`; UI at http://127.0.0.1:4111
bun run web:dev      # optional: Vite HMR on :5173, proxying /api and /ws to the engine port
```

`bun run dev` is `scripts/dev.ts`. It runs the engine with `bun --watch`, so **any file edit restarts the engine**. Don't edit engine code while that server has a goal running. See the warning in [testing.md](testing.md#manual-qa-against-a-throwaway-server).

## Working rules

The full rules are in [CONTRIBUTING.md](../../CONTRIBUTING.md). In short:

- **Commits** follow Conventional Commits. Keep each one small and focused on one logical change. The message is a short paragraph saying what changed and why.
- **No AI attribution** of any kind in commits or pull requests: no `Co-Authored-By` trailer for an assistant, no "generated with" footer.
- **Impact before edits.** If you have the GitNexus index locally (`CLAUDE.md` / `AGENTS.md` at the repo root are git-ignored, local-only guidance), run impact analysis on a symbol before you change it, and `detect_changes` before you commit.
- **Tests and types pass** before you push: `bun test packages` and `bun run typecheck`, both from the repo root.
- **The glossary is the language.** When you add a concept, add its term to `CONTEXT.md`. When you make a hard-to-reverse decision, add an ADR.
