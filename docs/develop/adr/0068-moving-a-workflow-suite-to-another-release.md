# ADR-0068: Moving a workflow suite to another release, after a forecast

**Status:** accepted · 2026-10-23 · amends ADR-0047 and ADR-0049

## Context

ADR-0047 pinned Matt Pocock's skills to one release, and ADR-0049 did the same for pstack, so that a skill a role
must follow does not change between two goals. Only a Foundry release moved a pin: the tag is written in
`catalog/skills.json`, reviewed with the rules that name its skills. Upstream moves faster than that. pstack went
from 0.9.93 to 0.9.101 in three days, and a person who wants a newer release has no way to take it.

A newer release can also take something away. Matt Pocock's repository renames and retires skills between minor
releases (`to-prd` became `to-spec`, `writing-great-skills` became `writing-for-agents`), and keeps a `deprecated/`
folder for what is on its way out. A workflow rule whose skill is gone falls back to the role's built-in instructions
without telling anyone. The person should know that before moving, not after the next goal.

Three questions had to be settled. Where the person's choice lives and how it relates to the catalog's pin. What
happens to an installed skill the new release no longer ships. How a suite installed as a Claude Code plugin moves,
since its release is fixed by Claude Code's marketplace entry rather than by Foundry.

## Decision

- **The choice lives in Settings** as `workflow.suiteReleases` (suite id → tag). A Move on the Extensions page writes
  it; there is no form field. One choice serves every coding agent.
- **The newer of the two is used.** The release in use is the newer of the catalog's pin and the person's choice.
  A later Foundry release that pins a newer one takes over, so a Foundry update never moves a suite back. A Move may
  go to the catalog's pin or any later release, so going back is possible down to the pin and no further. Moving to
  the pin clears the choice.
- **Only stable release tags count** (`v1.3.1`, `0.9.101`), as for Foundry's own releases.
- **The forecast comes first.** For each suite the Extensions page shows the release in use, how this computer has
  it (Foundry's copies, a Claude plugin, the suite's own copy), the releases upstream, and a forecast of the newest
  release: the skills it removes, the ones moved under `deprecated/`, the ones it adds, and the changelog headings in
  between. A removed skill carries the workflow rules Foundry gives it and the changelog lines that name it, the line
  that says what became of it first. When the newest release drops a skill in Foundry's catalog, the page says so on
  the suite's row before anything is opened. The Move button sits under the forecast, so a Move is never made blind.
- **The facts come from a probe repository** per suite under the skills cache: tags from `git ls-remote`, each tag
  fetched alone with `--depth 1`. It never touches the cache clones the installer and the update check reset.
  What a fetched tag ships is remembered in `skills-releases.json`, and a tag list is reused for six hours or until
  **Check for updates**.
- **What a Move does depends on how the suite is installed.** The suite's own copy is re-synced at the tag. Foundry's
  copies are updated at the tag; a skill the release keeps in another folder is followed there; a skill it no longer
  ships goes to the trash, where it can be restored. A Claude plugin has its marketplace re-pinned: the ref of the
  marketplace's entry in Claude Code's `settings.json` changes first, because the CLI refuses a re-add that does not
  match it, then `claude plugin marketplace add <repo>#<tag>` and `claude plugin update`. Both directions work.
  A suite that is not installed only keeps the choice, and its next install uses it.
- **Not while a goal runs.** A Move is refused while any work is active, so a goal's skills never change under it.

## Consequences

- A person can take pstack's and Matt Pocock's newer releases without waiting for Foundry, and sees what each costs
  the workflow before taking it. The catalog's rules are still written for the pinned release: a rule for a skill
  the newer release dropped is not given, and the role falls back to its built-in instructions, as when the skill is
  not installed.
- Matt Pocock's suite installed as a Claude plugin moves with the rest. Foundry now edits one key of Claude Code's
  `settings.json` (the marketplace entry's `ref`) and leaves everything else in the file as it was.
- The Extensions page asks GitHub for tags at most every six hours and fetches a release only to forecast it.
- Moving back below the catalog's pin is not offered. A Foundry release that adopts a newer suite still reviews its
  rules against it, as ADR-0047 asked; the person's choice only ever runs ahead of that.
