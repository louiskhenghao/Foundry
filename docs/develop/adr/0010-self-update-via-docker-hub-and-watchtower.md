# ADR-0010: Self-update: Docker Hub as version source, watchtower as the docker updater

**Status:** accepted · 2026-08-28

## Context

Foundry deployments (docker image or git-clone local) had no way to know their own version, notice a new one, or update. The GitHub repo (`louiskhenghao/Foundry`) is **private**, but the image (`imlouiskhenghao/foundry` on Docker Hub) is **public** — and the product is designed to be distributable, so nothing in the update path may require access to the private repo.

## Decision

- **Version source is the Docker Hub tags API** for *both* deployment modes — public, unauthenticated, and already carries versioned tags. Only stable `x.y.z` tags count; `latest` and suffixed tags are ignored. GitHub Releases was rejected because every deployed instance would need a token to a private repo.
- **Changelog lives in a separate public releases repo** (raw-readable), populated by the release script — because Docker Hub tags carry no notes and the main repo is unreadable to deployments.
- **One product version**: the root `package.json` version is canonical; workspace packages carry no independent versions. A local release script (`bun run release`) bumps it, git-tags, builds and pushes the multi-arch versioned image + `latest`, and pushes the changelog. CI comes later, if ever.
- **Docker self-update goes through a watchtower sidecar** in docker-compose, triggered over its HTTP API. Only watchtower mounts the docker socket — the Foundry container itself never touches it, which is the entire reason for the sidecar over self-mounting the socket (a compromised Foundry with the socket is root on the host). Writing our own updater sidecar was rejected as maintenance for no gain.
- **Local self-update is git-based with automatic rollback**: record the current commit, `git pull` → install → build, restore the recorded commit and *don't* restart on any failure; on success the server respawns itself and the UI reconnects.
- **Degradation is automatic, not an error**: an instance that can't self-update (no watchtower, user's own `docker run`, socket absent) turns the update button into a guided popup with the exact commands. The feature never hard-requires the new compose file.
- **Updates drain first**: no new sessions are accepted and active agents finish before the restart, with an explicit human override to update immediately.

## Consequences

- The update path works for third parties who only ever `docker pull` — the private repo can stay private.
- A release is not real until the script has pushed the versioned Docker Hub tag; forgetting the script means instances never see the version.
- Existing deployments keep working untouched; they just get guided updates until they adopt the sidecar compose file.
