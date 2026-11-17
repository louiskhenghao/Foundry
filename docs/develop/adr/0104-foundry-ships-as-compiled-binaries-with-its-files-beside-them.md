# ADR-0104: Foundry ships as compiled binaries with its files beside them, and releases live on GitHub Releases

**Status:** accepted · 2026-11-16 · amends ADR-0010 and ADR-0024

## Context

Foundry has run two ways: a git checkout served with Bun, and a Docker image. The image was the version source for both
(its Docker Hub tags) and the way a computer without a toolchain got Foundry. It is being retired: a container cannot read
the Keychain where Claude Code keeps its login on macOS, has no Antigravity CLI, sees repositories only through mounts and
under container paths, needs the host's Docker socket (root) to start a preview's databases, and every release rebuilds a
two-gigabyte image for half an hour. The design settled on 2026-11-16 replaces it with a macOS app (a menu bar shell around
the engine, a later ADR) and Linux binaries, both compiled with `bun build --compile`, published on GitHub Releases of the
public `foundry-releases` repository. This ADR is the base both stand on: how a compiled Foundry finds its files, loads
Playwright, runs its hooks, keeps its data, learns of a new version and replaces itself.

A compiled Bun executable has no source tree. `import.meta.dir` points into its virtual file system (`/$bunfs/root`), so
everything that resolved `roles/`, `catalog/skills.json`, `templates/`, `packages/runner/hooks`, `docs/guide`,
`apps/web/dist` and the root `package.json` from the checkout root would find nothing. Playwright cannot be bundled: it
finds its browsers from its own files on disk. The TypeScript hooks a session's settings start (`rm-guard.ts`,
`readonly-bash.ts`, `codex-guard.ts`, `agy-guard.ts`) ran as `bun <file>`, and nothing says a computer with the app has
Bun. The checkout's default data folder, `data/` in the tree, has no tree to sit in.

## Decision

- **One layout, the checkout's.** A release carries the executable with a `resources/` folder beside it (a tarball) or
  `Contents/Resources` inside the app bundle, and the folder keeps the checkout's relative paths: `roles/`, `catalog/`,
  `templates/`, `packages/runner/hooks/`, `packages/engine/recipes/`, `docs/guide/`, `apps/web/dist/`,
  `THIRD-PARTY-NOTICES.txt`, a `package.json` with the version, and `node_modules/playwright`. The engine's `rootDir`
  points at that folder and nothing that reads from the root changes. `installRoot()` (`packages/engine/src/install-root.ts`)
  detects it: `FOUNDRY_ROOT` names the folder outright; a compiled binary looks beside its real executable
  (`Contents/MacOS` → the app, `Contents/Resources`; otherwise `resources/`) and refuses to start when it is not there; a
  checkout is itself. Three install kinds follow: `checkout`, `app`, `binary`.
- **Playwright by path.** `loadPlaywright()` imports `<root>/node_modules/playwright/index.mjs` by file URL in every
  install, so the bundler never sees a literal `import('playwright')` and the checkout gets the same copy it depends on.
  The browser install runs Playwright's own CLI: with Bun from a checkout, inside foundry (`foundry playwright install
  chromium`) from a release, since a compiled install carries no runtime for `cli.js`.
- **Hooks inside the binary.** Each TypeScript hook exports a `run` beside its own entry point; a compiled foundry runs
  one as `foundry hook <name> [args]` and a checkout runs the file with the Bun that runs Foundry
  (`packages/runner/src/hook-command.ts`). The Codex and Antigravity runners take the hooks folder from the engine's
  config instead of their own source location. The shell hooks (`boundary-guard.sh`, `canary.sh`) need no runtime.
- **Data beside the platform's other applications.** A release install's default data folder is
  `~/Library/Application Support/Foundry/data` on macOS and `$XDG_DATA_HOME/foundry/data` (`~/.local/share/foundry/data`)
  elsewhere, `data-<provider>` for another launch profile; `~/.foundry/config.json` and `FOUNDRY_DATA_DIR` win as before
  (ADR-0082). A checkout keeps `data/` in its tree.
- **GitHub Releases is the version source for every install.** The update check reads the public releases repository's
  releases (`FOUNDRY_RELEASES_URL`), takes the newest stable, published one, and keeps its files; the changelog stays
  where it was. Docker Hub tags are read by nothing any more.
- **A release install updates by downloading, checking and swapping.** The engine downloads this computer's file
  (`Foundry-<v>-mac-universal.zip` for the app, `foundry-<v>-darwin-universal.tar.gz` or `foundry-<v>-linux-<arch>.tar.gz`
  for a tarball), checks it against the release's `SHA256SUMS`, unpacks it under the data folder's `updates/`, and then:
  the app writes `updates/ready.json` and exits with code 75, which its menu bar shell takes as "swap the bundle and start
  it again"; a tarball install lives as `<base>/<version>/` with `<base>/current` a symlink, moves the new version beside
  the old one, repoints `current` in one rename, and exits for its supervisor (or hands the port to a successor, as a
  checkout does). Without the shell (`FOUNDRY_APP_SHELL`), or without a `current` link, the install cannot self-update and
  the dialog shows the commands instead, as it always has. The drain, the force switch and the `update.run` record are
  unchanged.
- **Built where the release is cut.** `bun scripts/build-release.ts` compiles the executables (`bun-darwin-arm64` and
  `bun-darwin-x64` signed ad-hoc then joined with `lipo` into one universal file and signed again, `bun-linux-x64`,
  `bun-linux-arm64`), stages the resources once with Playwright installed flat (`bun install --linker=hoisted`), writes the
  tarballs and `SHA256SUMS`, and runs the host's own executable (`foundry version --json`) as its last check.
  `bun run release` builds them, creates a **draft** GitHub Release with the files, pushes the image (until it is retired),
  publishes the release — the moment instances see the version — and pushes `main` last. No CI, no signing identity: the
  executables are ad-hoc signed (Apple Silicon runs nothing unsigned), not notarized.
- **`foundry version`** says the version, the install kind and the root.

## Consequences

- Nothing in the engine resolves its files relative to its own source any more; every path goes through `rootDir`,
  `installRoot()` or `locatePlaywright()`. A new file the engine reads at runtime must be added to `RESOURCES` in
  `scripts/build-release.ts`, and `build-release` fails loudly when a listed folder is missing.
- Bun's cross-compiled executables cannot be `lipo`-ed as they come: the kernel kills any process that maps their stale
  signature (`SIGKILL, Code Signature Invalid`). Signing each slice ad-hoc first makes both the merge and the run work,
  natively and under Rosetta.
- The install kind is a third axis beside the deployment mode and the provider: `DeploymentMode` gains `app` and
  `binary`, the update dialog describes each, and the doctor reports the embedded runtime instead of looking for Bun.
- Every instance now depends on `api.github.com` for its daily check (sixty unauthenticated requests an hour per address
  are plenty for one check a day and a button). The releases repository's tags double as release markers.
- The macOS app itself — the Swift menu bar shell, the universal bundle, the `.dmg`, the `install.sh` modes that place
  the app or the tarball and migrate a source install — is the next ADR. The image's retirement, with the risk dialog a
  2.x shows before the jump to 3.0, is the one after.
