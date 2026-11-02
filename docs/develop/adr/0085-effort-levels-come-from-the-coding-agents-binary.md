# ADR-0085: Effort levels come from the coding agent's binary, and a level it no longer takes runs as its nearest neighbour

**Status:** accepted · 2026-11-02 · builds on [ADR-0010](0010-self-update.md) (models synced from the binary)

## Context

Foundry hands every session an effort level (`claude --effort <level>`), chosen on the New goal form or in Settings. The
levels were a fixed list in the code — low, medium, high, xhigh, max — in the goal schema, the settings schema, the API
bodies, the New goal form and the Settings select. Claude Code changes its plans and its levels between releases: the
person reported that the top level was being renamed (max → ultra) and asked how Foundry could follow such changes
without a code change every time. Model ids already come from the installed binary at each model sync (ADR-0010's
successor work); effort levels did not.

## Decision

- **The levels are read from the installed Claude Code.** At every model sync (a new CLI version triggers one) the
  engine runs `claude --help` and reads the levels the `--effort <level>` option names in parentheses; they are kept
  in the model registry's sync state beside the CLI version. `engine.effortLevels(provider)` returns them for Claude
  (the known five until the first sync), Codex's fixed set, and Antigravity's.
- **Everything that offers or checks a level uses that list.** The New goal form's effort buttons and the Settings
  select are built from `/api/models`' `effortLevels`, with a word of explanation for the levels that have one and the
  bare name for a new one; goal creation refuses a level the agent does not take, naming the ones it does; the goal and
  settings schemas take any non-empty level, since the list is the binary's to define.
- **A level the binary no longer takes runs as its nearest neighbour.** When a session asks for a level the current
  binary does not list (a goal made before a rename, a Settings default kept across an upgrade), the effort runner maps
  it up the ladder (none, minimal, low, medium, high, xhigh, max, ultra) to the next level the binary takes — a renamed
  top level lands on its new name — else down, and says so once in the log. Nothing fails for a name.
- Plan names (the subscription an account is on) were already shown as the CLI reports them and stay that way.

## Consequences

- A Claude Code release that renames or adds an effort level needs no Foundry release: the next sync offers the new
  names, and goals carrying the old one keep running. A Foundry release is needed only for a word of explanation on a
  new level, which is cosmetic.
- The levels can be wrong between a CLI upgrade and the next sync (the sync runs at start-up when the version changed,
  so the window is one restart); the runner's mapping covers the gap.
- The ladder's order is Foundry's knowledge, not the binary's: a level the ladder has never heard of ranks highest.

## Alternatives considered

- **A fixed list, updated by release.** Rejected: it is what the person asked to escape, and a goal created with a
  level the new CLI refuses would fail until the release.
- **Passing any string through unchecked.** Rejected: a typo on the command line would reach the CLI as an error in a
  session instead of at goal creation.
