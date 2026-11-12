# ADR-0090: Deploy — the whole project to a server of the person's own over SSH, after a readiness check, with credentials kept as files

**Status:** accepted · 2026-11-12 · amends ADR-0041 (the web hosts) and ADR-0003 (what the engine keeps)

## Context

Deploy (ADR-0041) puts a finished goal's web app on a host: Vercel, Netlify or Cloudflare Pages, through their CLIs
with a token. It refuses everything else on purpose — a worker, a backend apart from its pages, a custom server — since
those hosts do not run such things, and half a system online is a broken one. That left the goals Foundry builds most
often for a person with a machine of their own (an API with its database, a bot, a service with a worker beside it)
with nothing to click: the person copied the result over and ran it themselves.

The person's own server has what the hosts lack: it runs whatever a compose file names, so there is no half system to
deploy. What it needs from Foundry is the same as the hosts needed — an explicit act, the exact commands shown first,
a credential the engine keeps and no session gets — plus two things the hosts did not: a credential that is a file (an
SSH key, where the hosts had a token) and a first-time check, since a server is set up by hand and fails in ways a
host's API would have told at once (the key not authorised, Docker missing, the user not in the docker group). The
stores and the platforms as a service that come after this record (the design of 2026-11-11: Expo's EAS for iOS and
Android, Fly.io, Railway, Render) need both the file-shaped credentials and the readiness check too; this record puts
them in place with the first target that needs them.

## Decision

- **A server of the person's own is a Deploy place beside the hosts,** on the same card of the Delivery tab, chosen by
  name. ADR-0041's rule that only a web page or an all-in-one web app is deployed holds for the hosts; it is withdrawn
  for a server: any backend goes there, whole. What a server deploys is **the whole project as its compose file runs
  it** (`compose.yaml`, `compose.yml`, `docker-compose.yml`, `docker-compose.yaml`, in compose's own order), or a lone
  `Dockerfile` with an `EXPOSE`, wrapped in a one-service compose file Foundry writes into the checkout (never into
  the repository). A project with neither, or a Dockerfile without a port, is refused with the reason in words, the way
  the hosts refuse what they cannot run.
- **How it goes:** the engine's checkout of the goal's commit (ADR-0041's deploy folder) is streamed as a tar over the
  SSH connection into `<deploy folder>/<project name>` on the server (`.git`, installed packages and the hosts' folders
  left out; what is there is written over, never deleted, so a bind-mounted data folder beside the code survives), then
  `docker compose -p <project name> -f <file> up -d --build --remove-orphans` runs there. Nothing else is installed on
  either side: `ssh` and `tar` here (the Docker image gets `openssh-client`), Docker there. The project's name is the
  same as the hosts' project name for the repository, so every deploy of it lands in the same folder and compose project.
- **Always production, confirmed each time.** A server has no second address to put a preview on; two copies of a
  compose project would fight over its ports. The card's Production box is ticked and locked for a server, the
  confirmation says what is replaced and what stays (named volumes, files beside the code), and the Delivery
  notification is the one a production deploy gets. A smoke (ADR-0058) follows only when asked, as for production on
  a host.
- **The address** recorded with the deploy is the server's **public address** from Settings when one is set (a domain
  behind a reverse proxy, with its scheme), else `http://<host>:<the first port the compose file publishes>`. A project
  that publishes no port and has no public address ends **live with no address**: it runs, with nothing to open; the
  card and the notification say so, and a smoke is skipped with that reason.
- **Servers live in Settings → Git & delivery as a list:** a name, host, SSH port, user, the private key, the folder
  the projects go under (`~/foundry` by default; `~` is the user's home on the server) and the optional public address.
  **A credential inside a list item is treated as the secret settings are** (`delivery.servers.<id>.privateKey` beside
  `delivery.vercelToken`): null in the view the page gets, with a masked hint beside; a list saved back without its
  keys keeps the saved ones item by item, an empty string forgets one; sealed apart in a Transfer's Keys & secrets while
  the list itself travels as Settings, and put back onto the matching server on import; blanked out of what Memory
  sends. The engine's settings file holds them as it holds the tokens, readable by its owner only.
- **A credential that is a file is on disk only while a command runs:** written under the data folder's `tmp` with the
  owner's permissions, removed after the commands whatever they did, named on no command line Foundry records (the
  record shows `<key file>`). The hosts' tokens keep travelling in the environment; the key cannot, since `ssh` reads
  it from a file.
- **The readiness check:** before a first deploy to a place the card runs one, and shows every item it needs with what
  was found: for a host, its token in Settings; for a server, the key in Settings, an answer over SSH with that key,
  `docker compose` for that user there, and the deploy folder made and writable. An item that fails says where to put
  it right — a Settings section, a command to run (on the server: adding the key's public half, `usermod -aG docker`),
  a page (Docker's install guide) — and the items after one that could not be tried say so. The deploy button waits
  for every item; **Check again** tries once more. The check is the person's act from the card, never run on a timer.
- **SSH host keys:** a server's key is accepted the first time it is seen and kept in Foundry's own `known_hosts` under
  the data folder (`StrictHostKeyChecking=accept-new`), apart from the person's; one that changed since refuses the
  deploy, and the readiness check says so.
- **The boundary guard** that keeps a coding session from deploying (ADR-0041) now also blocks a remote `docker compose
  up|pull|down|run` through `ssh`, and — ahead of the targets that follow — Expo's `eas build|submit|update|credentials|
  device:create`, fastlane's `deliver|supply|pilot|match`, `fly|flyctl launch|secrets set`, `railway up|init|link|
  redeploy|variable set` and `render deploys|services create`. Building for a store, like deploying, is the person's
  act run by the engine: it spends the store's build minutes with a credential a session never gets.

## Considered options

- **rsync instead of a tar stream.** Rejected: rsync is not on the Docker image nor on every server, and `--delete`
  would take a data folder beside the code with it. A tar over the same ssh connection needs nothing installed and
  writes over what is there.
- **Pushing an image to a registry, then pulling on the server.** Rejected for now: one more account and credential,
  and the server builds from the source just as well. It stays the way for a server without the source's build
  tools, if one turns up.
- **A preview on the server as a second compose project (`<name>-preview`).** Rejected: the compose file's published
  ports collide unless the project parameterises them, which most do not; a second server marked for previews is a
  Settings shape for later if anyone needs it.
- **The server's keys as files the person points Settings at.** Rejected: the Docker install would need a volume for
  them, and a Transfer could not carry them; the settings file already holds credentials, readable by its owner only.
- **Readiness checked on a timer, or at every card load.** Rejected: each check opens an SSH connection to the person's
  server; a check they ask for, shown with its time, costs nothing when they are not deploying.

## Consequences

- `DeployProvider` gains `server`; `Deployment` and the deploy events gain an optional `target` (the server's id and
  the name it had), and `deploy.finished` a nullable `url`. Older events and rows replay unchanged (no target: a host).
  A deploy's smoke carries the target too, so its notification names the server.
- `delivery.servers` is a list setting with a secret per item: `SECRET_LIST_SETTINGS` names it, and the settings view,
  update, Transfer export and import, and Memory's scrub read that table. Later lists with a credential inside (a
  store's keys) join the table rather than growing new code paths.
- The Deploy card's places are keyed `<provider>` or `server:<id>`; the one the goal last deployed to comes first while
  it is still in Settings and takes the code.
- `GET /api/goals/:id/deploy/readiness?provider=&target=` tries a place now; `GET/POST /api/goals/:id/deploy` take
  `target`. The CLI is unchanged in this record.
- The user guide's Deploy and Git & delivery sections describe the server, the readiness check and the servers list;
  the Docker image installs `openssh-client`.
