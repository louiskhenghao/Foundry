# ADR-0048: gstack leaves Foundry

**Status:** accepted · 2026-10-20 · see ADR-0001 for the hooks, ADR-0047 for the retro clash

## Context

Foundry knew gstack in three places. The catalog listed it as a manual entry (clone it, run its setup). The scanner
recognised its clone under `~/.claude/skills/gstack` as a provenance family of its own and every flattened copy
beside it (`~/.claude/skills/<name>`, byte-identical to `gstack/<name>/SKILL.md`) as a `gstack-copy`; uninstall,
update and shadow cleanup each carried a branch for them. And the roadmap planned to spawn gstack's skills from
sessions (`GSTACK_SESSION_KIND=spawned`), add its audits as completion options, and import its learnings.

The integration stayed shallow. Foundry never ran gstack's setup, so on a machine where only the router is linked
its commands are not invocable from a session; its hooks run inside every spawned session (ADR-0001) and the plan
to silence them meant disabling all hooks for every Foundry session. And its skills share names with skills Foundry
does mandate: gstack ships a `retro`, and so does the mattpocock suite that ADR-0047 made the opener of the Learnings
session. The Extensions page took gstack's flattened `retro` for the mattpocock one, offered to adopt it, and the
"Install recommended" batch failed on it because the folder was not Foundry's to replace. Every fix meant more
gstack-shaped branches in code that is otherwise about where a skill comes from.

## Decision

Foundry no longer knows gstack.

- **No catalog entry.** The manual `gstack` entry is gone; the `manual` source type stays in the schema for an
  entry that needs it later.
- **No provenance family.** `ManagedBy` loses `gstack` and `gstack-copy`, `SkillSourceKind` and `SkillManager`
  lose `gstack`. A gstack clone on the machine is a hand-installed skill named `gstack`, its flattened copies are
  hand-installed skills, and the Extensions page groups them under "Hand-installed" like any other tool's copies.
- **No special cases.** Uninstall, bulk uninstall, shadow cleanup, the update report and the stale-shadow rule treat
  those folders by the general rules: a hand-installed copy can be trashed and restored; one that a plugin skill
  of the same name supersedes is a stale shadow; a catalog skill whose name a hand-installed folder holds is
  reported as an unmanaged copy, with **Replace** to swap it for the catalog version (the old copy goes to the
  trash).
- **The roadmap drops gstack.** No spawned gstack skills, no gstack audits as completion options, no learnings
  import. Second opinions on a Brief and audits at completion, when they come, are built on skills Foundry
  mandates.

## Consequences

- A person who keeps gstack installed sees its skills as hand-installed ones. Foundry will not update them (gstack
  does that itself) and will not stop a person from trashing a flattened copy; gstack recreates its copies on its
  next upgrade.
- The name clash is no longer hidden: with gstack's `retro` in `~/.claude/skills`, the mattpocock `retro` shows as
  an unmanaged copy until the person replaces it or installs the mattpocock plugin, whose namespaced
  `/mattpocock-skills:retro` the catalog prefers over any loose copy.
- The guide's Codex compatibility table loses its gstack row; the Codex operate page its gstack paragraph.
