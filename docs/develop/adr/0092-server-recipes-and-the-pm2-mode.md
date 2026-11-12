# ADR-0092: Server recipes — scripts that set a server up, run whole after the person reads them — and a PM2 mode for Node.js projects

**Status:** accepted · 2026-11-12 · amends ADR-0091

## Context

ADR-0091 put a server of the person's own beside the web hosts, and drew the line at the server itself: Foundry
installs and configures nothing there, it detects what is missing (Docker, something in front on 80/443, a
certificate) and says so, with the command or the page. On a fresh machine that leaves the person doing by hand what
they do on every new machine: install Docker, put nginx in front with a certificate, install Node and PM2, PostgreSQL,
Redis. People keep scripts for exactly this — the two that shaped this record set up an EC2 instance (Node, Yarn, PM2,
optional PostgreSQL with pgvector and Redis) and nginx with TLS in front of an app's port — and run them over ssh on
each new server. The alternative, a coding session that works out the server, spends tokens on a thing that is the
same every time and has its hands on a machine that is not a worktree.

The same scripts show how many people run Node.js projects on a server: not in containers, but installed on the host
and kept alive by PM2. Docker mode asks them to add a Dockerfile to every project first.

## Decision

- **Recipes.** A server recipe is a shell script, idempotent and non-interactive, with a header Foundry reads: its id,
  title, whether it needs root, which readiness item it puts right (`fixes`), its inputs (`param: NAME | label |
  default`, `secret` as the default for a secret) and what it changes on the server (`changes:` lines). Foundry
  bundles five under `packages/engine/recipes/server`, modelled on the scripts above: `install-docker` (Docker Engine
  and the compose plugin from Docker's apt repository, the deploy user into the docker group), `nginx-site` (nginx in
  front of the project's port with HTTPS from a certificate the person pastes — a Cloudflare origin certificate or
  their own — or from Let's Encrypt through certbot, or HTTP only behind Cloudflare; an existing site file kept as
  `.bak.foundry-<time>`, the stock default site left alone, ufw opened when active, nginx reloaded and never stopped),
  `install-node-pm2` (Node.js from NodeSource, Yarn, PM2 registered with systemd for the user), `install-postgres`
  (PostgreSQL with pgvector, the role's password, the app's databases, optionally open to every address with the
  warning the original script carried) and `install-redis`. **The person's own scripts** under the data folder's
  `server-recipes/` are recipes too, by the same header, or named after their file when they say nothing of themselves.
  No model reads or writes a recipe; it is the same text every time.
- **A recipe never runs by itself.** The Deploy card offers it beside the readiness item it fixes (Docker missing, the
  user not in the docker group, nothing in front on 80/443, the public address answering nothing, Node or PM2 missing),
  with the project's values filled in (the public address's domain, the project's port and name); Settings → Git &
  delivery → Servers offers every recipe for a saved server. Either way the dialog shows **the whole script** and
  what its header says it changes, takes its inputs, and asks the person to say they read it before **Run the
  script**. It runs once, over ssh, as root through `sudo -n` (as itself when the ssh user is root); the inputs go in
  front of the script as `export` lines, on stdin, never on a command line, and the remote shell reads the whole text
  before anything runs (`bash -c "$(cat)"`), so no command inside can eat the rest of the script. A user who cannot
  sudo without a password is told, nothing runs, and the script is theirs to copy and run. Every run is an event
  without a goal (`server.recipe_started`, `server.recipe_finished`), its output kept with a secret input's value
  blanked out; the Settings page lists a server's runs. One recipe at a time per server; never on a timer. This is the
  one way Foundry changes a server outside a project's folder, and it changes exactly what the script the person read
  says.
- **PM2 mode.** A server has a `mode`: `docker` (ADR-0091's compose deploy) or `pm2`. In PM2 mode a goal's project must
  be a Node.js project with a start script or an `ecosystem.config.js`; anything else is refused in words. The deploy
  copies the checkout as before, then on the server installs with the package manager its lockfile names (yarn,
  pnpm, npm, bun; yarn berry immutably), builds when there is a build script, and runs `pm2 startOrReload
  <ecosystem> --update-env && pm2 save`. A project without an ecosystem file gets `ecosystem.foundry.config.cjs`
  written into the checkout (its start script under the project's name, `NODE_ENV=production`, the port when an env
  file or a Dockerfile names it), never into the repository. The readiness check asks for Node.js and PM2 for that user
  instead of Docker (the `install-node-pm2` recipe puts it right), and a published port held by `node` in the
  project's own folder counts as the project's. The confirmation says plainly that the process runs as the ssh user on
  the host, with no container around it, and that Foundry touches the project's folder and its PM2 process only.
- **The boundary guard** also blocks `pm2 start|restart|reload|startOrReload|deploy|delete` through `ssh` for coding
  sessions; a local `pm2` stays theirs.

## Considered options

- **A coding session that sets the server up.** Rejected: tokens for a thing that is the same on every machine, and a
  session with its hands on a server that is not a worktree, where the boundary guard does not reach.
- **Foundry running its own reverse proxy in a container (Caddy).** Deferred: the person's existing nginx and
  certificate habits are what the recipe reproduces; a container proxy is a recipe to add if anyone needs it.
- **Recipes run without the dialog, from the readiness item in one click.** Rejected: a script as root on the person's
  server is read first, every time; the header's `changes` lines exist so the reading is short.
- **Recipes as templates a model fills.** Rejected: the inputs are a handful of environment variables; a form fills
  them, and the script stays exactly the text the person read.
- **PM2 mode as a separate deploy provider.** Rejected: it is the same server, the same ssh, the same folder rules; a
  mode on the server keeps one card, one record and one readiness check.

## Consequences

- `DeployServer` gains `mode`; `ServerApp` a `pm2` kind with its facts; `ReadinessItem.fix` a `recipe` and its
  `recipeParams`; new schemas `ServerRecipe`, `RecipeParam`, `RecipeRun`; events `server.recipe_started` and
  `server.recipe_finished` with `goalId` null. The process runner takes an optional `stdin`.
- Routes: `GET /api/servers/recipes`, `GET /api/servers/:id/recipes/runs`, `POST /api/servers/:id/recipes/:recipe/run`.
- The bundled recipes are Ubuntu/Debian scripts; `install-docker` says so and stops on anything else. A recipe's
  failure leaves the server as the script left it — the scripts are idempotent, so running one again after the cause
  is mended is the way on.
- ADR-0091's "Foundry installs and configures nothing on the server" becomes "nothing but what a recipe the person
  read and confirmed says"; its detection and remedies stay.
