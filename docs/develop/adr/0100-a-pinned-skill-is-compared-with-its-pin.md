# ADR-0100: A pinned skill is compared with its pin, and every waiting update runs from one button

**Status:** accepted · 2026-11-16 · builds on ADR-0049 and ADR-0068

## Context

The catalog pins some git entries to one commit (`source.ref`, forty hex characters): a repository without releases,
such as HyperFrames' skills, is pinned so that every Foundry at the same version installs the same bytes, and a Foundry
release moves the pin. The installer honours the pin: an install or an **Update** resets the cache clone to it and copies
from there, and the marker records that commit.

The update checker did not know about pins. It fetched the repository, reset the cache clone to the default branch's
head, and compared the installed copy with the skill's folder there. For a pinned skill that is a comparison with
something **Update** would never install: the source read **update available**, the person pressed **Update**, the
installer re-copied the pin, and the run ended `no change` — then the next check said **update available** again. Five
HyperFrames skills sat in that loop for weeks.

A second false alarm had another cause: a skill's scripts leave files behind when they run (`__pycache__` under
ppt-master's scripts), and the fingerprint of the installed folder counted them, so a copy at the very commit it was
installed from read **outdated**.

Separately, with ten sources waiting at once, pressing **Update** on each in turn was the only way to take them all.

## Decision

**The pin is what a pinned skill is compared with.** For a Foundry-managed row whose catalog entry pins a commit or a
tag, the checker lists the skill folder's files at the pin from the cache clone (`git ls-tree`, by blob id, as the local
fingerprint hashes them) and compares the installed copy with that. The same files: **up to date**, whatever upstream's
head holds. Different files but the marker at the pin: **modified** — edited on this computer. Different files from
another commit: **outdated**, and **Update** moves the copy to the pin. The row and the source carry the pin
(`pinned: { ref, commit, behind }`): `behind` says upstream changed the folder since the pin, and the source says it in a
hint — **Pinned to ce9830f by Foundry's catalog: upstream has changed these skills since, and Foundry moves the pin in a
release of its own** — as news, never as an update waiting. A branch name is a moving target, not a pin, and is compared
as before. The cache clone holds the pin because the installer fetched it; a pin it does not hold falls back to the
comparison with head.

**What scripts leave behind is not a change of the skill.** The fingerprints leave out `__pycache__`, `.venv`, `venv`,
`.pytest_cache`, `.mypy_cache`, `.ruff_cache` and `.tox` as they left out `node_modules`.

**Update all** runs every source with an update waiting, one after another, as one operation of the operations dock:
Foundry's own installs, `npx skills` (named the source's outdated skills, so one source's run does not redo another's),
Claude plugins and the workflow suites. A source that only carries a hint is skipped and said so. Each source's run is
still recorded on its own in History, and the operation's summary counts them: updated, already current, failed, without
an updater. One update runs at a time server-wide, so **Update all** is refused while a source update runs, and the
other way round.

## Consequences

- **update available** means it: pressing **Update** changes the copy. A pinned skill whose upstream moved on says so
  without asking anything of the person; adopting upstream's changes is a change of the catalog's pin, made in a Foundry
  release as before.
- The catalog's pins become visible on the Extensions page (`pinned ce9830f`), which they were not.
- A hand edit of a pinned copy reads **modified**, as a hand edit of any other managed copy does.
- The checker runs two more git commands per pinned row (`rev-parse`, `ls-tree`, and `rev-list` for `behind`), on the
  local clone, on a check that already fetches.
