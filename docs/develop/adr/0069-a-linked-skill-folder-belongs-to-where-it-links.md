# ADR-0069: A linked skill folder belongs to where it links

**Status:** accepted · 2026-10-23 · amends ADR-0048

## Context

ADR-0048 took gstack out of Foundry and left its skills to the general rules. Under those rules, a hand-installed
folder that holds a catalog skill's name is reported as a copy of it, offered for **Adopt**, and counted as a stale
shadow when a plugin ships a skill of the same name. Every one of those rules matches skills by name.

Names are not unique across tools. gstack installs each of its skills as a folder in `~/.claude/skills` whose
`SKILL.md` links into its own clone, and re-links them when they go missing. Its `retro` is a weekly retrospective;
Matt Pocock's `retro`, in the catalog and in his plugin, is a session retrospective. With both on one machine the
Extensions page offered to adopt gstack's `retro` and to trash it as a stale shadow, the doctor reported a stale copy,
and installing the mattpocock bundle took the folder over and moved gstack's skill to the trash. gstack linked it
back at its next run.

## Decision

- **A linked folder belongs to where it links.** A skill folder that is a link, or whose `SKILL.md` is a link, into
  another folder is classified as linked (`managedBy: symlink`, its target the folder it links into). This is a
  general rule, with no knowledge of gstack.
- **It is never matched by name.** The update report lists linked folders as one source, **Linked from another
  folder**, with no catalog id and no shadow. It offers no **Adopt**, never counts one as a stale shadow, and the
  shadow cleanup skips it. Its only action is **Uninstall**, which removes the folder and leaves its target.
- **Installing a bundle keeps it.** A catalog entry that a linked folder satisfies by name is reported as kept by the
  bundle install. Its folder is not replaced.
- **Plugin first in the catalog status.** When a plugin ships a catalog skill, the entry is `installed-via-plugin`
  even if a loose folder of the same name is present. The plugin's copy was already the one sessions invoke.

## Consequences

- With Matt Pocock's plugin installed, gstack's `retro` stays where it is, and the Learnings session keeps opening
  with `/mattpocock-skills:retro`.
- Without that plugin, a linked folder still satisfies a catalog entry by name, as ADR-0048 has it, so a session may
  be told to invoke a different skill of the same name. Installing the suite as a plugin, or removing the link,
  resolves it.
- A folder the person linked to their own clone of a catalog skill is no longer offered for **Adopt**. The person
  keeps it current where it links, or replaces it from the catalog.
