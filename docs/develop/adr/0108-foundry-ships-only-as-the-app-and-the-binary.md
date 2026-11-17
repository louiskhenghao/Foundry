# ADR-0108: Foundry ships only as the app and the binary

**Status:** accepted · 2026-11-17 · builds on ADR-0104, ADR-0105, ADR-0106 and ADR-0107 · supersedes ADR-0010's watchtower
update and ADR-0024's source and Docker install modes

## Context

ADR-0104 and ADR-0105 made Foundry a compiled release: the macOS app and the Linux binary, from GitHub Releases. ADR-0106
gave the last 2.x a switch to them, and ADR-0107 a move that takes one click from any earlier install, source or Docker,
on the same computer. The person who owns the project settled on 2026-11-16 that 3.0 ships only the compiled release:
"3.0 后就是2进制了". What the image and the source install still carried was large: a Dockerfile installing a dozen
tools, a compose file with a watchtower updater and a Hindsight service, an entrypoint, install.sh's source and Docker
modes with their own tool recipes, the updater's Docker mode, and code that only made sense inside the container.

## Decision

- **No image.** The Dockerfile, docker-compose.yml, docker-entrypoint.sh, docker-google-chrome.sh and .dockerignore are
  deleted, and `bun run release` no longer needs buildx or pushes to Docker Hub. The tags there stay as they are:
  2.36.0 is the last image, and `latest` stays on it.
- **The installer installs the app or the binary.** `install.sh --mode app|binary`, the app on a Mac and the binary on
  Linux by default. Its source and Docker modes, their tool recipes and `--dir`, `--repos`, `--ref` and
  `--with hindsight` are gone; `--mode source|docker` is refused with what to run instead. An install it finds recorded
  from 2.x (source or Docker) is not reinstalled: the installer installs the app or the binary and offers to move its
  goals (ADR-0107). `foundry setup` installs the tools the image used to carry.
- **A checkout stays, for working on Foundry.** `bun run serve` in a git checkout keeps the *local* deployment mode and
  its git update, and a checkout still sees a switch at a new major (ADR-0106). It is no longer a way to install.
- **The updater has no Docker mode.** Its watchtower path and the image option are gone, and `FOUNDRY_DOCKER` makes
  nothing a container: an instance is the app, the binary or a checkout.
- **What only the image needed goes.** The folder browser's `/repos` and shared projects folder, the Ports page's
  container note, the data folder fixed by a volume mount, and the variables only the image or its compose file set
  (`FOUNDRY_WATCHTOWER_URL`/`TOKEN`, `FOUNDRY_HOST_DOCKER`, `FOUNDRY_CONTAINER`, `FOUNDRY_HOST_REPOS`, `FOUNDRY_REPOS`,
  `FOUNDRY_SKIP_SETUP`, `COMPOSE_PROFILES`). An MCP server's sign-in runs headless where there is no display (a Linux
  server), where it used to key on the image.
- **The preview code's container handling stays, inert.** Binding previews to 0.0.0.0 and starting a project's services
  on the host's Docker from inside the container read `FOUNDRY_DOCKER` and `FOUNDRY_HOST_DOCKER`, which nothing sets
  any more. That code sits on the paths every task start takes (impact analysis rates it critical), so it is left for a
  change of its own rather than removed with the image.
- **Moving from Docker stays.** The move still finds Foundry containers and brings their goals over (ADR-0107), and
  `foundry repath` stays. Users' projects keep everything Docker does for them: preview services from a project's
  compose file (ADR-0021), Deploy with docker compose (ADR-0091, ADR-0092), PaaS builds from a Dockerfile (ADR-0095).
- **The credits follow the release.** The Open source credits page and THIRD-PARTY-NOTICES.txt list what the release
  ships (the npm packages and the Bun runtime compiled into foundry) and, apart, the tools `foundry setup` installs from
  their own releases. A test keeps the second list equal to what setup installs.
- **Memory connects to a server the person runs.** The compose profile that ran a Hindsight server beside the container
  is gone with the compose file; Memory connects to one (ADR-0072) until Foundry runs one itself.

## Consequences

- One way to install on each platform, built and tested as the release. A source or Docker install moves with one
  click, or one command on a container's host.
- A computer the binary cannot run on (a musl Linux such as Alpine, an architecture other than x64 and arm64) has no
  install any more; the installer says so. Windows runs the Linux binary under WSL.
- The preview code keeps a container branch nothing reaches until its own change removes it.
