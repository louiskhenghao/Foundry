# ADR-0093: Runtime variables per deploy place, and the platforms — Fly.io, Railway and Render — beside the servers

**Status:** accepted · 2026-11-12 · amends ADR-0091 and ADR-0041

## Context

ADR-0091 put a server of the person's own beside the web hosts, and ADR-0092 gave it recipes and a PM2 mode. Two
things were left open there. A project online needs what its `.env.example` lists — a database address, an API key,
a session secret — and the previews' variables (ADR-0063) are the previews': entered per repository, meant for a
process on this computer, never sent anywhere. A server deploy had nothing to give the compose services, so a
project that reads `DATABASE_URL` started with it unset. And the servers are the only way to run the whole project;
many people run a backend on a platform instead — Fly.io, Railway, Render — where a preview can stand beside
production, a thing a single server cannot offer (ADR-0091 made every server deploy production).

The platforms differ in how they take code. Fly.io and Railway have CLIs that deploy a folder from here (Fly.io builds
a Dockerfile remotely; Railway builds from the stack itself, with Nixpacks/Railpack, or from a Dockerfile). Render has
no CLI deploy: a service is bound to a repository's branch on GitHub or GitLab and its API deploys a commit of that
branch. Their credentials differ too (a Fly.io token, a Railway account or workspace token, a Render API key), and
each wants its runtime variables in its own store, set before the deploy so the first start has them.

## Decision

- **Runtime variables, per repository and per place.** A second store beside the previews' (`deploy-env.json`, the
  same shape and the same owner-only file mode), keyed by repository and place: `server:<id>`, `fly`, `railway`,
  `render`. The Deploy card shows them for the chosen server or platform as the previews' dialog does — names only,
  what the example files list without a value, what each name is — with **Import from your checkout** and **Copy
  from the previews** adding names not set yet; a saved value is never shown again. The hosts (Vercel, Netlify,
  Cloudflare Pages) keep their own environment settings and get none. A Transfer seals them under Keys & secrets as
  repository → place → variables. They reach the place at deploy time and nowhere else: a server's compose project
  gets a `.foundry.env` file (owner-only) and a `compose.foundry.env.yaml` override that hands it to every service as
  `env_file`; a PM2 project has the file sourced before `pm2 startOrReload`; Fly.io gets them as staged secrets
  (`fly secrets import --stage`, on stdin), Railway through `railway variable set --skip-deploys`, Render in the
  service's `envVars` when it is made and `PUT /services/{id}/env-vars` after. Values are blanked out of every deploy
  record, never enter the goal's folder where sessions work, and the readiness check lists the example keys without
  a value as a warning that never blocks (example files list optional settings too).
- **The platforms are a third kind of place** (`kind: paas`), between the hosts and the servers on the card: the
  whole project like a server, a preview beside production like a host. Production goes to the app, environment or
  service under the project's name (`deployName`); a preview to `<name>-preview` on Fly.io and Render, and to a
  `preview` environment of the same project on Railway. Each is made once, by the deploy, with its token; nothing is
  made ahead of time. What a platform takes: a `Dockerfile` (any platform); else the stack — Node.js from
  `package.json`, Python, Go, Ruby, Rust, Elixir from their manifests — which Railway builds itself and Render runs
  with a build and a start command read from `package.json` scripts or a `Procfile`'s `web:` line (a Node.js project
  without a start script, or another stack without a `Procfile`, is refused in words). Fly.io is given Dockerfiles
  only: its own `fly launch` scanner would write a `fly.toml` into the project, which is the project's, so Foundry
  writes a `fly.foundry.toml` of its own (the app's name, the region from Settings, the port from `EXPOSE` or an env
  file, a small machine that stops when idle) and deploys with `--config` it. The follow-up goal of ADR-0091 writes
  the Dockerfile when a project has none. In a monorepo the web app's folder (ADR-0041's detection) is the project
  for a platform too.
- **Fly.io and Railway run through their CLIs** in Foundry's checkout of the goal's commit, like the hosts: the token in
  the command's environment (`FLY_API_TOKEN`, `RAILWAY_API_TOKEN`), never on a command line, `CI=1` so nothing waits
  for a person. Fly.io: `apps create` (a name already taken is no failure), `secrets import --stage`, `deploy
  --remote-only --yes --ha=false`, `status --json` for the hostname. Railway: `link` the project and service, else
  `init` and `add` them (one shell line, so the card shows it whole); `environment new preview` once; `environment
  <env>`; the variables; `up --ci`; `domain` (made once, answered thereafter). `flyctl` is a Go binary the person
  installs (the readiness check asks for it and links the install page; the Docker image carries it); Railway's CLI
  runs through `npx @railway/cli@5`.
- **Render runs through its API**, since a deploy there is a commit of a pushed branch: `GET /owners` for the workspace
  when Settings names none, `GET /services?name=` then `POST /services` once (`autoDeploy: no`, so Render deploys only
  what Foundry asks; the production service on the goal's base branch, the preview service on the goal's branch;
  `rootDir` for a monorepo; the region and plan from Settings), the variables, `POST /services/{id}/deploys` with the
  commit, polled until `live` or a failed state, then the service's `url`. The goal's repository must have a GitHub
  remote and the branch there must already hold the commit (checked with `git branch -r --contains`); a Local only
  goal, an unpushed branch, or a production deploy of a goal not merged yet is refused in words before any call.
  Render's GitHub app must be allowed on the repository; the error from `POST /services` is translated when it says
  so. A fetch seam (`engine.paasFetch`) and a poll interval stand in for the network in tests.
- **Settings → Git & delivery → Platforms** holds the tokens (`delivery.flyToken`, `railwayToken`, `renderApiKey`:
  secrets, from the environment too as `FLY_API_TOKEN`, `RAILWAY_API_TOKEN`, `RENDER_API_KEY`) and the facts a first
  deploy needs (Fly.io organization and region, Railway workspace, Render owner, region and plan). The tokens stay
  with the engine like the hosts'; no coding session gets them.
- **Nothing of the project changes.** `fly.foundry.toml`, `.foundry.env` and `compose.foundry.env.yaml` are written into
  Foundry's checkout only and are never committed back (ADR-0041's commit of a host's files leaves them out).

## Considered options

- **The previews' variables sent to the deploy place.** Rejected: they are a development set (a local database, test
  keys), and one set per repository cannot tell a server from a platform from production. Copying from them is one
  click when they are right.
- **Variables typed into a text area as a `.env` file.** Rejected: the previews' dialog already knows the example
  files, explains each name and never shows a saved value; the same component serves both.
- **`fly launch` to detect and configure the app.** Rejected: it writes `fly.toml` into the project and asks questions;
  Foundry's own config file keeps the project untouched and the run non-interactive.
- **Render through a CLI.** None deploys a folder; its API is small and documented, and a deploy there is a pushed
  commit anyway.
- **Railway's `up` with a Dockerfile only.** Rejected: building from the stack is what Railway is for, and a project
  without a Dockerfile is the common case; Fly.io's remote builder wants one, so it says so and names Railway.
- **One `preview` app per goal on Fly.io.** Rejected: apps are a quota and a bill; one preview app per repository,
  replaced by each preview deploy, matches the hosts' one preview address per project.

## Consequences

- `DeployProvider` gains `fly`, `railway` and `render`; `DeployPlace.kind` a `paas`; `DeployInfo` a `paas` map of what
  each platform would run; `DeliverySettings` the nine platform fields; `TransferSecrets` a `deployEnv` map.
- New modules `engine/src/deploy/env.ts` (the store, the view, the env file and override) and `engine/src/deploy/paas.ts`
  (deployability, steps, config, URL and error reading, Render's API). `DeployStep` carries an optional `stdin`, and
  the process runner's `exec` passes it through.
- Routes: `GET/PUT /api/goals/:id/deploy/env?place=`, `POST …/deploy/env/from-preview`, `POST …/deploy/env/import`; the
  deploy and readiness routes take the three new providers. The readiness items of a platform: its token, `flyctl`
  on this computer (Fly.io), the GitHub remote and the key's workspace (Render), the runtime variables (warn).
- The boundary guard also blocks `fly apps create`, `fly secrets import`, `railway add|domain|environment new` for
  sessions; `fly status`, `railway logs` and the like stay theirs.
- The Docker image installs `flyctl`; the user guide's Deploy and Git & delivery sections describe the platforms and the
  runtime variables; the Transfer guide names the deploy variables under Keys & secrets.
