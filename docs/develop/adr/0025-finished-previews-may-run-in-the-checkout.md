# ADR-0025: A finished goal's preview may run in the person's checkout

**Status:** accepted · 2026-10-07

## Context

Once a goal is finished and merged, Foundry cleans up its progress folder and the preview runs the base branch in a
detached preview folder beside it. That folder starts empty of everything git does not track: no `node_modules`, so
every first start installs dependencies, and no untracked env files, so apps that need a database URL or an API key fail
until the person enters or imports them. Meanwhile the person's own checkout is usually on that same base branch with
both already in place, and is what they would run by hand.

## Decision

- While a goal is being worked on, the preview runs its progress folder, as before.
- Once it is finished, the person picks where it runs: **auto** (the default), **your checkout** or **Foundry's
  preview folder**.
  - **auto** runs the checkout when its current branch is the branch the preview would run, otherwise the preview folder.
  - **your checkout** runs the checkout as it is, on whatever branch it is on; the branch menu does not apply.
  - **Foundry's preview folder** keeps the earlier behaviour.
- Foundry never switches, resets, pulls or cleans the checkout for a preview. Only the dev servers' own writes (build
  caches, an install when `node_modules` is missing) land there.
- The choice is recorded on the goal (`goal.preview_place_set`) and can change only while none of its apps runs.

## Consequences

- A merged goal's preview usually starts at once and with the person's env files, without importing anything.
- The preview of the checkout shows uncommitted changes the person has there; the card says it runs "as it is".
- A checkout on another branch silently means the preview folder under **auto**; the card says why.
