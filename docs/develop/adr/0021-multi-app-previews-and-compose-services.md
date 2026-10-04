# ADR-0021: Several apps per preview, and the compose services they need

**Status:** accepted · 2026-10-05 · amends the Preview part of ADR-0012

## Context

ADR-0012 gave each goal one dev server. A monorepo has several apps a person runs side by side (a web app, an admin
console, the API they both call), and most of them need services from the repository's compose file (Postgres, object
storage, a cache) before they start. With one server per goal the person could look at only one app, and only after
starting its dependencies by hand.

## Decision

- **Apps.** A goal's preview is a list of apps, each a dev server in its own folder of the progress folder, on its own
  port from the preview range, with its own start/stop, readiness and log channel (`preview-<goalId>-<appKey>`). The list
  comes from the Brief's `apps` (Clarify fills it only when detection would be wrong; the human can edit it), else the
  Brief's single `run`, else package.json `workspaces` / `pnpm-workspace.yaml` packages that have a dev/start script and
  live under `apps/` or depend on an app framework, else the root package.json. The first app is the *primary* one:
  milestones, the self-check and the existing single-app fields of the preview status describe it.
- **Addresses.** Ports are handed out before any app starts, and every app gets every app's address as
  `FOUNDRY_APP_<KEY>_URL`, so a web app can be pointed at its API with no fixed port. Apps whose own config fixes a port
  give that URL in the Brief.
- **Services.** Before apps start, the engine brings up the compose file's dependency services — those with an `image`
  and no `build` (built services are the apps, which run natively). One compose project per repository
  (`foundry-<repo>`), shared by all its goals, with the goal's compose file and the person's checkout as project
  directory, so relative volumes and env files are shared too. A service whose published host port is already taken is
  treated as provided by something else (the person's own Postgres) and is not started. Services keep running when the
  previews stop (data and warm starts survive); the preview card stops them.
- **Docker image.** Foundry's own container has no Docker access (ADR-0010 keeps the socket in watchtower only). There,
  and without a docker CLI, the preview card lists the services and the command to run instead; nothing is started.

## Consequences

- More ports per goal: the range (default 4200–4299) bounds how many apps can run at once across goals.
- Per-goal isolated databases are not provided: goals of one repository share its services and their data.
- Compose features beyond `image`, `ports` and `build` detection (profiles, `extends`, several files) are passed to
  `docker compose` as they are; only the dependency list and published ports are read by Foundry.
- `preview.started` / `preview.stopped` events carry the app key; earlier events without it describe the single app.
