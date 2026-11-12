/**
 * Deploy (ADR-0041, ADR-0091): a finished goal, published when the person asks — a web page or an all-in-one web app
 * to a host (a preview address by default, production when they say so), or the whole project to a server of their
 * own over SSH (always production, confirmed each time).
 *
 * The deploy runs in a checkout of the goal's commit of its own (one folder per repository, named after the host
 * project, so the host's link and the installed packages stay between deploys), one command after another, each
 * recorded without its tokens. Nothing is pushed to the repository; the host gets the files or the source it builds,
 * the server gets the files and builds them itself.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DeployProvider, DeployReadiness, DeployServer, DeployTarget, Goal, ReadinessItem } from '@foundry/core';
import { getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { exec, git } from '../git/git.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { type Deployability, deployability } from './detect.ts';
import { keepDeployFiles } from './keep-files.ts';
import { CLI, PROVIDER_LABEL, SUPPORTS, type DeployCredentials, type DeployProvider as HostProvider, configured, deploySteps, deployedUrl, failureHint, isHost, lastWords, plain, projectName, redact, wentToProduction, whereLabel } from './providers.ts';
import { withSecretFile } from './secret-file.ts';
import { GENERATED_COMPOSE, GENERATED_ECOSYSTEM, type ServerDeployability, generatedCompose, generatedEcosystem, pm2Steps, serverAddress, serverDeployability, serverReadiness, serverSteps } from './server.ts';
import { runSmoke, smokeScripts, type SmokeTarget } from './smoke.ts';

/** a goal is deployed once it is done: a failed or unfinished goal's branch is not a thing to publish */
export const DEPLOYABLE_STATES = new Set(['done', 'over_delivered']);

export interface DeployRequest {
  provider: DeployProvider;
  /** the server (its id in Settings) when the provider is `server` */
  target?: string | null;
  production: boolean;
  /**
   * try the goal's milestone scripts against the address afterwards (ADR-0058): a preview's default, never
   * production's unless asked, since a script writes what it tries
   */
  smoke?: boolean;
}
export const smokeByDefault = (production: boolean) => !production;
const STEP_TIMEOUT_MS = 20 * 60_000;

export function deployCredentials(engine: Engine): DeployCredentials {
  const d = engine.settings.values().delivery;
  return { vercelToken: d.vercelToken, vercelScope: d.vercelScope, netlifyToken: d.netlifyToken, netlifyTeam: d.netlifyTeam, cloudflareToken: d.cloudflareToken, cloudflareAccountId: d.cloudflareAccountId };
}
/** the servers in Settings (ADR-0091) */
export const deployServers = (engine: Engine): DeployServer[] => engine.settings.values().delivery.servers;
/** the server a request names, or why there is none */
export function serverFor(engine: Engine, target: string | null | undefined): DeployServer {
  const s = target ? deployServers(engine).find((x) => x.id === target) : undefined;
  if (!s) throw new Error(target ? 'that server is not in Settings any more' : 'no server was chosen: a server deploy names one from Settings → Git & delivery');
  return s;
}
/** the SSH host keys Foundry has accepted, apart from the person's own */
export const knownHostsFile = (engine: Engine) => join(engine.config.dataDir, 'deploy', 'known_hosts');

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** the host's project or site for this repository, the same for every deploy of it */
export const deployName = (goal: Pick<Goal, 'repoPath'>) => projectName(goal.repoPath, hash(goal.repoPath));
/** the folder a repository's deploys run in */
export const deployDir = (engine: Engine, goal: Pick<Goal, 'repoPath'>) => join(engine.config.dataDir, 'deploy', deployName(goal));

/** the commit to deploy: the goal's branch, or the base branch once the goal was merged there and its branch removed */
async function deployRef(goal: Goal): Promise<string | null> {
  for (const ref of [goal.branch, goal.baseBranch]) {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], goal.repoPath);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

/**
 * a checkout of `ref` in the deploy folder: made once, then moved; ignored files (installed packages) stay, and so do the
 * hosts' links to their site whether the project ignores them or not — an unlinked folder naming an existing Netlify site
 * gets a new site of its own (`<name>-<suffix>`) on every deploy
 */
async function checkout(goal: Goal, dir: string, ref: string): Promise<void> {
  if (!existsSync(join(dir, '.git'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    await git(['worktree', 'prune'], goal.repoPath);
    const r = await git(['worktree', 'add', '--detach', '--force', dir, ref], goal.repoPath);
    if (r.code !== 0) throw new Error(`could not check the goal out for deploying: ${r.stderr.trim() || r.stdout.trim()}`);
    return;
  }
  const r = await git(['checkout', '--force', '--detach', ref], dir);
  if (r.code !== 0) throw new Error(`could not move the deploy folder to the goal's commit: ${r.stderr.trim()}`);
  await git(['clean', '-fd', '-e', '.netlify', '-e', '.vercel'], dir);
}

/** where a build left its files: the framework's folder, else the first usual one with an index.html (Angular nests it) */
export function findOutput(cwd: string, preferred: string): string {
  const has = (rel: string) => existsSync(join(cwd, rel, 'index.html'));
  if (has(preferred)) return preferred;
  for (const rel of ['dist', 'build', 'out', 'public', '_site']) {
    if (has(rel)) return rel;
    let names: string[] = [];
    try {
      names = existsSync(join(cwd, rel)) && statSync(join(cwd, rel)).isDirectory() ? readdirSync(join(cwd, rel)).sort() : [];
    } catch {}
    for (const n of names) {
      if (has(join(rel, n))) return join(rel, n);
      if (has(join(rel, n, 'browser'))) return join(rel, n, 'browser');
    }
  }
  return preferred;
}

/** the folder a goal's code is read from: the goal's folder when it is still there, else its repository */
const codeDir = (engine: Engine, goal: Goal) => {
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  return existsSync(ws) ? ws : goal.repoPath;
};
/** what a host can deploy of a goal now, read from its code */
export function goalDeployability(engine: Engine, goal: Goal): Deployability {
  return deployability(codeDir(engine, goal));
}
/** what a server can run of a goal now (ADR-0091): its compose file or Dockerfile; in PM2 mode (ADR-0092) its Node.js project */
export function goalServerDeployability(engine: Engine, goal: Goal, mode: DeployServer['mode'] = 'docker'): ServerDeployability {
  return serverDeployability(codeDir(engine, goal), mode, deployName(goal));
}

/** the reason a host cannot take an app of this kind, or null when it can */
export function unsupported(provider: HostProvider, d: Deployability): string | null {
  if (!d.ok || SUPPORTS[provider].includes(d.app.kind)) return null;
  return `${PROVIDER_LABEL[provider]} gets a folder of files from Foundry, and ${d.app.framework} renders on a server: deploy it to Vercel or Netlify.`;
}

/** the deploys running now, per goal (the engine waits for them when it stops) */
const running = new Map<string, Promise<void>>();
/** the smokes running on their own (Smoke again), per goal */
const smokes = new Map<string, Promise<void>>();
/** one deploy or smoke per repository folder at a time: they share it */
const folders = new Map<string, Promise<unknown>>();
export const deployWork = () => [...running.values(), ...smokes.values()];
export const deploying = (goalId: string) => running.has(goalId);
export const smoking = (goalId: string) => smokes.has(goalId);

/**
 * Start a deploy; what is wrong is thrown at once (a goal not done, a host not set up, a server without its key, a
 * deploy already running), the rest happens in the background and in the goal's events.
 */
export function startDeploy(engine: Engine, goalId: string, req: DeployRequest): void {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  if (!DEPLOYABLE_STATES.has(goal.state)) throw new Error(`the goal is ${goal.state.replace(/_/g, ' ')}: only a finished goal is deployed`);
  if (isHost(req.provider)) {
    if (!configured(req.provider, deployCredentials(engine))) throw new Error(`${PROVIDER_LABEL[req.provider]} is not set up: add its token in Settings → Git & delivery`);
  } else {
    const s = serverFor(engine, req.target);
    if (!s.privateKey) throw new Error(`the server ${s.name} has no SSH key: add it in Settings → Git & delivery`);
  }
  if (running.has(goalId)) throw new Error('a deploy of this goal is running');
  const dir = deployDir(engine, goal);
  const work = (folders.get(dir) ?? Promise.resolve()).then(() => run(engine, goal, dir, req));
  folders.set(dir, work);
  const done = work.catch(() => {}).finally(() => {
    running.delete(goalId);
    if (folders.get(dir) === work) folders.delete(dir);
  });
  running.set(goalId, done);
}

async function run(engine: Engine, goal: Goal, dir: string, req: DeployRequest): Promise<void> {
  const { store } = engine;
  const c = deployCredentials(engine);
  const { provider } = req;
  // a server has no preview: whatever was asked, a server deploy is production
  const production = isHost(provider) ? req.production : true;
  let target: DeployTarget | null = null;
  const fail = (reason: string) => void store.append({ type: 'deploy.failed', goalId: goal.id, payload: { provider, target, production, reason: redact(reason, c).slice(0, 1_000) } });
  try {
    // a server removed from Settings between the click and its turn in the folder's queue fails in words, like the rest
    if (!isHost(provider)) {
      const s = serverFor(engine, req.target);
      target = { id: s.id, label: s.name };
    }
    const ref = await deployRef(goal);
    if (!ref) return fail(`neither the goal's branch (${goal.branch}) nor its base branch (${goal.baseBranch}) is in the repository any more`);
    await checkout(goal, dir, ref);
    if (!isHost(provider)) return await runServer(engine, goal, dir, ref, serverFor(engine, req.target), target!, req, fail);
    const d = deployability(dir);
    if (!d.ok) return fail(d.reason);
    const refused = unsupported(provider, d);
    if (refused) return fail(refused);
    const started = store.append({ type: 'deploy.started', goalId: goal.id, payload: { provider, target, production, ref, framework: d.app.framework, dir: d.app.dir } });
    for (const note of d.notes) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${note}` } });
    const cwd = join(dir, d.app.dir);
    // a redirect to a Workers build's config, ignored by git so the checkout keeps it (Wrangler's hand-over of a new
    // project to Workers leaves one); a build that makes it makes it again, and a stale one fails every Pages deploy
    if (provider === 'cloudflare') rmSync(join(cwd, '.wrangler', 'deploy'), { recursive: true, force: true });
    const steps = deploySteps({
      provider,
      cwd,
      kind: d.app.kind,
      name: deployName(goal),
      production,
      // Cloudflare files a preview under a branch name of letters, digits and dashes
      branch: goal.branch.replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 28),
      productionBranch: goal.baseBranch,
      install: d.app.install,
      build: d.app.build,
      outputDir: d.app.outputDir,
      message: `${goal.title} (Foundry)`,
      credentials: c,
      cli: engine.deployCli,
    });
    let last = '';
    for (const step of steps) {
      // a Cloudflare upload takes what the build left, wherever the framework put it
      if (provider === 'cloudflare' && step.argv.includes('deploy') && d.app.kind === 'built') {
        const at = step.argv.indexOf('deploy') + 1;
        step.argv[at] = findOutput(cwd, d.app.outputDir);
      }
      const t0 = Date.now();
      const r = await exec(step.argv, step.cwd, { timeoutMs: STEP_TIMEOUT_MS, env: step.env });
      const out = plain(`${r.stdout}\n${r.stderr}`).trim();
      store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, target, label: step.label, command: redact(step.argv.join(' '), c), exitCode: r.code, durationMs: Date.now() - t0, outputTail: redact(out.slice(-3_000), c) } });
      if (r.code !== 0 && !(step.okIf && step.okIf.test(out))) {
        const hint = failureHint(provider, out, c);
        return fail(`${step.label} failed (exit ${r.code}): ${hint ? `${hint} (${lastWords(out)})` : lastWords(out)}`);
      }
      last = plain(r.stdout);
    }
    // a host may put the deploy elsewhere than asked: Vercel sends a new project's first deploy to production
    const live = wentToProduction(provider, last, production);
    const url = deployedUrl(provider, last, live);
    if (!url) return fail(`${PROVIDER_LABEL[provider]} finished but named no address: its output is in the activity`);
    store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, target, production: live, url } });
    const moved = live && !production;
    if (moved) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${PROVIDER_LABEL[provider]} put this deploy in production although a preview was asked for: a new project’s first deploy goes to production there; the next ones are previews` } });
    // what the host's CLI added to the project goes to GitHub as the goal did, before a smoke writes its own files here
    await keepDeployFiles(engine, getGoal(store.db, goal.id) ?? goal, dir, { provider, outputDirs: [join(d.app.dir, d.app.outputDir), join(d.app.dir, findOutput(cwd, d.app.outputDir))] });
    // the smoke (ADR-0058): the milestone scripts against the address, in this checkout; it records its own end
    if (!(req.smoke ?? smokeByDefault(production))) return;
    // a smoke asked for a preview never writes into production
    if (moved && smokeScripts(engine, goal.id).length) store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { provider, target, production: live, url, deployedAt: started.ts, status: 'skipped', detail: `not tried: ${PROVIDER_LABEL[provider]} put this deploy in production, and the smoke was asked for a preview (a script writes what it tries)`, scripts: [] } });
    else await runSmoke(engine, goal, dir, { provider, target, production, url, deployedAt: started.ts });
  } catch (err) {
    fail(String((err as Error)?.message ?? err));
  }
}

/**
 * A server deploy (ADR-0091): the checkout copied over SSH and started there with docker compose, the key on disk only
 * while the commands run. The address is the server's public one, else its host and the first published port; a smoke
 * follows only when asked, since a server deploy is production.
 */
async function runServer(engine: Engine, goal: Goal, dir: string, ref: string, server: DeployServer, target: DeployTarget, req: DeployRequest, fail: (reason: string) => void): Promise<void> {
  const { store } = engine;
  const provider = 'server' as const;
  const name = deployName(goal);
  const d = serverDeployability(dir, server.mode, name);
  if (!d.ok) return fail(d.reason);
  // the compose file is reviewed before it runs on the server: what reaches outside its project is refused unless the
  // server's settings allow it, and then it is said in the goal's activity
  if (d.app.review.dangers.length) {
    if (!server.allowPrivileged) return fail(`${d.app.file} reaches outside its project, which the server ${server.name} does not allow: ${d.app.review.dangers.join('; ')}. Edit the file, or allow it for this server under Settings → Git & delivery → Servers.`);
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `deploy: ${d.app.file} reaches outside its project, allowed for the server ${server.name}: ${d.app.review.dangers.join('; ')}` } });
  }
  const framework = d.app.kind === 'compose' ? `docker compose (${d.app.file})` : d.app.kind === 'dockerfile' ? 'Dockerfile' : `PM2 (${d.app.pm2!.manager})`;
  const started = store.append({ type: 'deploy.started', goalId: goal.id, payload: { provider, target, production: true, ref, framework, dir: '' } });
  for (const note of d.notes) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${note}` } });
  // a lone Dockerfile gets the compose file Foundry writes, a Node.js project without an ecosystem file the one Foundry
  // writes: in the checkout only, the repository never sees them
  if (d.app.kind === 'dockerfile') writeFileSync(join(dir, GENERATED_COMPOSE), generatedCompose(d.app.port!));
  if (d.app.kind === 'pm2' && d.app.pm2!.generated) writeFileSync(join(dir, GENERATED_ECOSYSTEM), generatedEcosystem(name, d.app.pm2!.manager, d.app.port));
  const ok = await withSecretFile(engine.config.dataDir, 'id_deploy', server.privateKey!, async (keyFile) => {
    mkdirSync(dirname(knownHostsFile(engine)), { recursive: true });
    const plan = { server, name, checkout: dir, keyFile, knownHosts: knownHostsFile(engine), file: d.app.file, ssh: engine.deploySsh };
    const steps = d.app.kind === 'pm2' ? pm2Steps({ ...plan, pm2: d.app.pm2! }) : serverSteps(plan);
    for (const step of steps) {
      const t0 = Date.now();
      const r = await exec(step.argv, step.cwd, { timeoutMs: STEP_TIMEOUT_MS, env: step.env });
      const out = plain(`${r.stdout}\n${r.stderr}`).trim();
      // the record names no path under the data folder: the key file, the known hosts and the checkout stand in
      const shown = step.argv.join(' ').split(keyFile).join('<key file>').split(knownHostsFile(engine)).join('<known hosts>').split(dir).join('<deploy folder>');
      store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, target, label: step.label, command: shown, exitCode: r.code, durationMs: Date.now() - t0, outputTail: out.slice(-3_000) } });
      if (r.code !== 0) {
        fail(`${step.label} failed (exit ${r.code}): ${lastWords(out)}`);
        return false;
      }
    }
    return true;
  });
  if (!ok) return;
  const url = serverAddress(server, d.app);
  store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, target, production: true, url } });
  if (!(req.smoke ?? false)) return;
  if (!url) {
    if (smokeScripts(engine, goal.id).length) store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { provider, target, production: true, url: '', deployedAt: started.ts, status: 'skipped', detail: 'not tried: the project publishes no port and the server has no public address, so there is nothing to open', scripts: [] } });
    return;
  }
  await runSmoke(engine, goal, dir, { provider, target, production: true, url, deployedAt: started.ts });
}

/**
 * Whether a deploy of this goal to one place can start (ADR-0091): a host needs its token in Settings; a server its
 * key, an answer over SSH, docker compose for that user, the project's folder free or Foundry's, and the ports the
 * project publishes free — tried now, with the key on disk only meanwhile. What is in front on 80/443 and whether the
 * public address answers are told but never block.
 */
export async function deployReadiness(engine: Engine, goalId: string, provider: DeployProvider, target: string | null | undefined): Promise<DeployReadiness> {
  const at = new Date().toISOString();
  if (isHost(provider)) {
    const ok = configured(provider, deployCredentials(engine));
    const items: ReadinessItem[] = [{ id: 'token', label: `${PROVIDER_LABEL[provider]} token in Settings`, ok, severity: 'error', detail: ok ? 'set' : `add it under Settings → Git & delivery → Deploy`, fix: ok ? null : { settings: 'git' } }];
    return { ok, items, at };
  }
  const server = serverFor(engine, target);
  const goal = getGoal(engine.store.db, goalId);
  const app = goal ? goalServerDeployability(engine, goal, server.mode) : null;
  const project = goal ? { name: deployName(goal), ports: app?.ok ? app.app.review.ports : [] } : null;
  const deps = { knownHosts: knownHostsFile(engine), ssh: engine.deploySsh, project, run: (argv: string[], cwd: string, opts: { timeoutMs: number }) => exec(argv, cwd, opts) };
  mkdirSync(dirname(deps.knownHosts), { recursive: true });
  const items = server.privateKey ? await withSecretFile(engine.config.dataDir, 'id_deploy', server.privateKey, (keyFile) => serverReadiness(server, { ...deps, keyFile })) : await serverReadiness(server, { ...deps, keyFile: null });
  return { ok: items.every((i) => i.ok || i.severity === 'warn'), items, at };
}

/**
 * Try the milestone scripts against a live deploy again (the host's environment was changed, a script mended): what is
 * wrong is thrown at once, the smoke runs in the background in the deploy folder, after any deploy or smoke using it.
 */
export function smokeAgain(engine: Engine, goalId: string, deployedAt: string): void {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  const dep = (goal.deployments ?? []).find((d) => d.at === deployedAt);
  if (!dep) throw new Error('that deploy is not on the goal');
  if (dep.status !== 'live' || !dep.url) throw new Error(`that deploy ${dep.status === 'running' ? 'is still running' : dep.status === 'failed' ? 'failed' : 'has no address'}: only a live address is tried`);
  if (running.has(goalId)) throw new Error('a deploy of this goal is running');
  if (smokes.has(goalId)) throw new Error('a smoke of this goal is running');
  if (!smokeScripts(engine, goalId).length) throw new Error('the goal has no milestone scripts to try against it');
  const dir = deployDir(engine, goal);
  const target: SmokeTarget = { provider: dep.provider, target: dep.target ?? null, production: dep.production, url: dep.url, deployedAt };
  const work = (folders.get(dir) ?? Promise.resolve()).then(() => smokeInFolder(engine, goal, dir, target, dep.ref));
  folders.set(dir, work);
  const done = work.catch(() => {}).finally(() => {
    smokes.delete(goalId);
    if (folders.get(dir) === work) folders.delete(dir);
  });
  smokes.set(goalId, done);
}

/** the deploy folder at the deployed commit, then the smoke; a checkout that fails is the smoke's failure */
async function smokeInFolder(engine: Engine, goal: Goal, dir: string, target: SmokeTarget, ref: string | null): Promise<void> {
  try {
    const at = ref ?? (await deployRef(goal));
    if (!at) throw new Error(`neither the goal's branch (${goal.branch}) nor its base branch (${goal.baseBranch}) is in the repository any more`);
    await checkout(goal, dir, at);
  } catch (err) {
    engine.store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { ...target, status: 'fail', detail: `could not check the deployed commit out: ${String((err as Error)?.message ?? err)}`.slice(0, 1_000), scripts: [] } });
    return;
  }
  await runSmoke(engine, goal, dir, target);
}

/** how a host's CLI is run: `npx` with the pinned major version (it is cached after the first deploy) */
export const npxCli = (p: HostProvider): string[] => ['npx', '--yes', CLI[p].pkg];
export { whereLabel };
