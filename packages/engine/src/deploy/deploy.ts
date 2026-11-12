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
import { getGoal, listGoals } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { exec, git } from '../git/git.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { type Deployability, deployability } from './detect.ts';
import { keepDeployFiles } from './keep-files.ts';
import { CLI, PROVIDER_LABEL, SUPPORTS, type DeployCredentials, type DeployProvider as HostProvider, configured, deploySteps, deployedUrl, failureHint, isHost, isPaas, isStore, lastWords, plain, projectName, redact, wentToProduction, whereLabel } from './providers.ts';
import { EAS_BUILD_DONE, EAS_CLI, FOUNDRY_PROFILE, STORE_LABEL, STORE_PLATFORM, type ExpoDeployability, type StoreProvider, easBuildPage, easEnv, easFailureHint, easSubmissionUrl, expoDeployability, parseEasBuild, parseEasSubmission, writeEasProfiles } from './eas.ts';
import { type AscCredentials, appStoreUrl, ascApp, ascBuild, ascConsoleUrl, ascVersionFor, storeStanding } from './asc.ts';
import { parseServiceAccount, playAppReachable, playConsoleUrl } from './play.ts';
import { FLY_CONFIG, PAAS_LABEL, RENDER_API, RENDER_DONE, type PaasApp, type PaasCredentials, type PaasDeployability, type PaasProvider, type RenderCall, flyConfig, paasConfigured, paasDeployability, paasFailureHint, paasSecrets, paasSteps, paasTarget, paasUrl, renderApi, renderRepoUrl, renderServiceBody } from './paas.ts';
import { redactor } from '../preview/env.ts';
import { FOUNDRY_ENV_FILE, deployEnvView, deployVars, writeServerEnv } from './env.ts';
import { withSecretFile } from './secret-file.ts';
import { GENERATED_COMPOSE, GENERATED_ECOSYSTEM, type ServerDeployability, generatedCompose, generatedEcosystem, pm2Steps, serverAddress, serverDeployability, serverReadiness, serverSteps, shellQuote } from './server.ts';
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
/** the platforms' credentials (ADR-0093) */
export function paasCredentials(engine: Engine): PaasCredentials {
  const d = engine.settings.values().delivery;
  return { flyToken: d.flyToken, flyOrg: d.flyOrg, flyRegion: d.flyRegion, railwayToken: d.railwayToken, railwayWorkspace: d.railwayWorkspace, renderApiKey: d.renderApiKey, renderOwner: d.renderOwner, renderRegion: d.renderRegion, renderPlan: d.renderPlan };
}
/** how a CLI is run: the hosts' through npx (pinned), Fly.io's binary from the PATH, Railway's and EAS's packages through npx */
export const defaultCli = (p: HostProvider | 'fly' | 'railway' | 'eas'): string[] => (p === 'fly' ? ['fly'] : p === 'railway' ? ['npx', '--yes', '@railway/cli@5'] : p === 'eas' ? ['npx', '--yes', EAS_CLI.pkg] : npxCli(p));
/** the stores' credentials (ADR-0094): Expo's token, App Store Connect's key, Google Play's service account */
export interface StoreCredentials {
  expoToken: string | null;
  asc: AscCredentials | null;
  playServiceAccount: string | null;
}
export function storeCredentials(engine: Engine): StoreCredentials {
  const d = engine.settings.values().delivery;
  return { expoToken: d.expoToken, asc: d.ascKeyId && d.ascIssuerId && d.ascKey ? { keyId: d.ascKeyId, issuerId: d.ascIssuerId, key: d.ascKey } : null, playServiceAccount: d.playServiceAccount };
}
/** what a store would build of a goal now (ADR-0094): the Expo app, with the id the store wants */
export function goalStoreDeployability(engine: Engine, goal: Goal, provider: StoreProvider): ExpoDeployability {
  return expoDeployability(codeDir(engine, goal), provider);
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
/** what a platform would run of a goal now (ADR-0093): its Dockerfile, or its stack (the web app's folder in a monorepo) */
export function goalPaasDeployability(engine: Engine, goal: Goal, provider: PaasProvider): PaasDeployability {
  const root = codeDir(engine, goal);
  const web = deployability(root);
  return paasDeployability(root, provider, web.ok ? web.app.dir : '');
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
  } else if (isPaas(req.provider)) {
    if (!paasConfigured(req.provider, paasCredentials(engine))) throw new Error(`${PAAS_LABEL[req.provider]} is not set up: add its token in Settings → Git & delivery`);
  } else if (isStore(req.provider)) {
    if (!storeCredentials(engine).expoToken) throw new Error(`${STORE_LABEL[req.provider]} is not set up: add the Expo token in Settings → Git & delivery → Stores`);
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
  const production = provider === 'server' ? true : req.production;
  let target: DeployTarget | null = null;
  const fail = (reason: string) => void store.append({ type: 'deploy.failed', goalId: goal.id, payload: { provider, target, production, reason: redact(reason, c).slice(0, 1_000) } });
  try {
    // a server removed from Settings between the click and its turn in the folder's queue fails in words, like the rest
    if (provider === 'server') {
      const s = serverFor(engine, req.target);
      target = { id: s.id, label: s.name };
    }
    const ref = await deployRef(goal);
    if (!ref) return fail(`neither the goal's branch (${goal.branch}) nor its base branch (${goal.baseBranch}) is in the repository any more`);
    await checkout(goal, dir, ref);
    if (provider === 'server') return await runServer(engine, goal, dir, ref, serverFor(engine, req.target), target!, req, fail);
    if (isPaas(provider)) return await runPaas(engine, goal, dir, ref, provider, production, req, fail);
    if (isStore(provider)) return await runStore(engine, goal, dir, ref, provider, production, fail);
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
  // the runtime variables kept for this place (ADR-0093) go with the checkout as an env file the services read, or the
  // PM2 process starts with; their values are blanked out of every record, as the hosts' tokens are
  const vars = deployVars(engine, goal, `server:${server.id}`);
  const hasVars = Object.keys(vars).length > 0;
  const override = hasVars ? writeServerEnv(dir, vars, d.app.kind === 'pm2' ? null : d.app.services) : null;
  const hide = redactor(Object.values(vars));
  if (hasVars) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${Object.keys(vars).length} runtime variable${Object.keys(vars).length === 1 ? '' : 's'} go with it (${Object.keys(vars).sort().join(', ')})` } });
  const ok = await withSecretFile(engine.config.dataDir, 'id_deploy', server.privateKey!, async (keyFile) => {
    mkdirSync(dirname(knownHostsFile(engine)), { recursive: true });
    const plan = { server, name, checkout: dir, keyFile, knownHosts: knownHostsFile(engine), file: d.app.file, ssh: engine.deploySsh, overrides: override ? [override] : [], envFile: hasVars ? FOUNDRY_ENV_FILE : null };
    const steps = d.app.kind === 'pm2' ? pm2Steps({ ...plan, pm2: d.app.pm2! }) : serverSteps(plan);
    for (const step of steps) {
      const t0 = Date.now();
      const r = await exec(step.argv, step.cwd, { timeoutMs: STEP_TIMEOUT_MS, env: step.env });
      const out = hide(plain(`${r.stdout}\n${r.stderr}`).trim());
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
  // a PM2 project's port may come from its runtime variables alone (PORT), when no file names it
  const url = serverAddress(server, { port: d.app.port ?? (/^\d{2,5}$/.test(vars.PORT ?? '') ? Number(vars.PORT) : null) });
  store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, target, production: true, url } });
  if (!(req.smoke ?? false)) return;
  if (!url) {
    if (smokeScripts(engine, goal.id).length) store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { provider, target, production: true, url: '', deployedAt: started.ts, status: 'skipped', detail: 'not tried: the project publishes no port and the server has no public address, so there is nothing to open', scripts: [] } });
    return;
  }
  await runSmoke(engine, goal, dir, { provider, target, production: true, url, deployedAt: started.ts });
}

/**
 * A platform deploy (ADR-0093): the project from its Dockerfile or its stack, to a preview app, environment or service,
 * or to production. Fly.io and Railway take the checkout through their CLIs; Render deploys the repository's pushed
 * branch through its API. The place's runtime variables go to the platform's own store first; their values and the
 * tokens are blanked out of every record.
 */
async function runPaas(engine: Engine, goal: Goal, dir: string, ref: string, provider: PaasProvider, production: boolean, req: DeployRequest, fail: (reason: string) => void): Promise<void> {
  const { store } = engine;
  const c = paasCredentials(engine);
  const web = deployability(dir);
  const d = paasDeployability(dir, provider, web.ok ? web.app.dir : '');
  if (!d.ok) return fail(d.reason);
  const name = deployName(goal);
  const vars = deployVars(engine, goal, provider);
  const hide = redactor(paasSecrets(c, vars));
  const t = paasTarget(provider, name, production);
  const started = store.append({ type: 'deploy.started', goalId: goal.id, payload: { provider, target: null, production, ref, framework: `${PAAS_LABEL[provider]} (${d.app.runtime}, from ${d.app.from})`, dir: d.app.dir } });
  for (const note of d.notes) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${note}` } });
  if (Object.keys(vars).length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${Object.keys(vars).length} runtime variable${Object.keys(vars).length === 1 ? ' goes' : 's go'} to ${PAAS_LABEL[provider]} first (${Object.keys(vars).sort().join(', ')})` } });
  const record = (label: string, command: string, exitCode: number | null, durationMs: number, out: string) => store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, target: null, label, command: hide(command), exitCode, durationMs, outputTail: hide(out).slice(-3_000) } });
  let url: string | null = null;
  if (provider === 'render') {
    url = await renderDeploy(engine, goal, ref, production, d.app, name, vars, c, record, fail);
    if (!url) return;
  } else {
    const cwd = join(dir, d.app.dir);
    if (provider === 'fly') writeFileSync(join(cwd, FLY_CONFIG), flyConfig(t.service, c.flyRegion, d.app.port));
    const steps = paasSteps({ provider, cwd, app: d.app, name, production, credentials: c, vars, cli: engine.deployCli });
    let last = '';
    for (const step of steps) {
      const t0 = Date.now();
      const r = await exec(step.argv, step.cwd, { timeoutMs: STEP_TIMEOUT_MS, env: step.env, ...(step.stdin != null ? { stdin: step.stdin } : {}) });
      const out = plain(`${r.stdout}\n${r.stderr}`).trim();
      record(step.label, step.argv.join(' ').split(dir).join('<deploy folder>'), r.code, Date.now() - t0, out);
      if (r.code !== 0 && !(step.okIf && step.okIf.test(out))) {
        const hint = paasFailureHint(provider, out);
        return fail(`${step.label} failed (exit ${r.code}): ${hint ? `${hint} (${hide(lastWords(out))})` : hide(lastWords(out))}`);
      }
      last = plain(r.stdout);
    }
    url = paasUrl(provider, last);
    if (!url) return fail(`${PAAS_LABEL[provider]} finished but named no address: its output is in the activity`);
  }
  store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, target: null, production, url } });
  if (!(req.smoke ?? smokeByDefault(production))) return;
  await runSmoke(engine, goal, dir, { provider, target: null, production, url, deployedAt: started.ts });
}

/** Render, through its API: the service from the repository's pushed branch (made once), its variables, one deploy of the commit, watched to its end; returns the address, or null after `fail` */
async function renderDeploy(engine: Engine, goal: Goal, ref: string, production: boolean, app: PaasApp, name: string, vars: Record<string, string>, c: PaasCredentials, record: (label: string, command: string, exitCode: number | null, durationMs: number, out: string) => unknown, fail: (reason: string) => void): Promise<string | null> {
  const key = c.renderApiKey!;
  const call = async (label: string, rc: RenderCall) => {
    const t0 = Date.now();
    const res = await renderApi(key, rc, engine.paasFetch);
    record(label, `${rc.method} ${RENDER_API}${rc.path}`, res.status, Date.now() - t0, typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
    return res;
  };
  const remote = await git(['remote', 'get-url', 'origin'], goal.repoPath);
  const repo = renderRepoUrl(remote.code === 0 ? remote.stdout : null);
  if (!repo) {
    fail('Render deploys the repository from GitHub, and this one has no GitHub remote (a Local only goal): deliver it to GitHub first');
    return null;
  }
  const branch = production ? goal.baseBranch : goal.branch;
  const on = await git(['branch', '-r', '--contains', ref], goal.repoPath);
  if (!on.stdout.split('\n').some((l) => l.trim() === `origin/${branch}`)) {
    fail(production ? `Render deploys production from ${branch} on GitHub, and this commit is not on it there yet: merge the goal first (or deploy a preview, from the goal's branch)` : `Render deploys from GitHub, and ${branch} there does not have this commit yet: deliver the goal (push its branch) first`);
    return null;
  }
  let owner = c.renderOwner;
  if (!owner) {
    const r = await call('the Render workspace', { method: 'GET', path: '/owners?limit=1' });
    owner = Array.isArray(r.data) ? ((r.data[0] as { owner?: { id?: string } } | undefined)?.owner?.id ?? null) : null;
    if (r.status === 401 || !owner) {
      fail(r.status === 401 ? 'Render refused the API key: set Settings → Git & delivery → Render API key to one from the dashboard (Account Settings → API Keys)' : 'Render named no workspace for this key: set Settings → Git & delivery → Render owner to the workspace id (usr-… or tea-…)');
      return null;
    }
  }
  const svcName = paasTarget('render', name, production).service;
  const list = await call(`find the service ${svcName}`, { method: 'GET', path: `/services?name=${encodeURIComponent(svcName)}&limit=20` });
  let service = (Array.isArray(list.data) ? (list.data as { service?: { id: string; name: string } }[]).map((x) => x.service).find((x) => x?.name === svcName) : undefined) ?? null;
  if (!service) {
    const made = await call(`make the service ${svcName} from ${repo} (${branch}), once`, { method: 'POST', path: '/services', body: renderServiceBody({ name: svcName, ownerId: owner, repo, branch, rootDir: app.dir, app, region: c.renderRegion, plan: c.renderPlan, vars }) });
    service = (made.data as { service?: { id: string; name: string } } | null)?.service ?? null;
    if (made.status >= 300 || !service) {
      const msg = typeof made.data === 'object' && made.data && 'message' in made.data ? String((made.data as { message: unknown }).message) : String(made.data).slice(0, 300);
      fail(/not access repo|repository|permission/i.test(msg) ? `Render cannot reach ${repo}: connect Render's GitHub app to the repository first (github.com/apps/render/installations/new), then deploy again (${msg})` : `Render refused to make the service (HTTP ${made.status}): ${msg}`);
      return null;
    }
  } else if (Object.keys(vars).length) {
    const put = await call('set the runtime variables', { method: 'PUT', path: `/services/${service.id}/env-vars`, body: Object.entries(vars).map(([key, value]) => ({ key, value })) });
    if (put.status >= 300) {
      fail(`Render refused the runtime variables (HTTP ${put.status})`);
      return null;
    }
  }
  const dep = await call(`deploy ${ref.slice(0, 7)} on ${svcName}`, { method: 'POST', path: `/services/${service.id}/deploys`, body: { commitId: ref } });
  const deployId = (dep.data as { id?: string } | null)?.id;
  if (dep.status >= 300 || !deployId) {
    fail(`Render refused the deploy (HTTP ${dep.status}): ${String(typeof dep.data === 'object' && dep.data && 'message' in dep.data ? (dep.data as { message: unknown }).message : dep.data).slice(0, 300)}`);
    return null;
  }
  const until = Date.now() + STEP_TIMEOUT_MS;
  let status = 'created';
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, engine.paasPollMs));
    const d = await call('watch the deploy', { method: 'GET', path: `/services/${service.id}/deploys/${deployId}` });
    status = String((d.data as { status?: string } | null)?.status ?? status);
    if (RENDER_DONE.has(status)) break;
  }
  if (status !== 'live') {
    fail(status === 'created' || !RENDER_DONE.has(status) ? `Render's deploy was still ${status} after ${STEP_TIMEOUT_MS / 60_000} minutes: see the service in the dashboard` : `Render's deploy ended ${status.replace(/_/g, ' ')}: see the service's logs in the dashboard`);
    return null;
  }
  const got = await call('read the address', { method: 'GET', path: `/services/${service.id}` });
  const url = (got.data as { serviceDetails?: { url?: string } } | null)?.serviceDetails?.url ?? null;
  if (!url) {
    fail('Render named no address for the service: see it in the dashboard');
    return null;
  }
  return url;
}


/** how long a cloud build may take before Foundry stops waiting (the build goes on at EAS; its page is linked) */
const BUILD_WAIT_MS = 90 * 60_000;
/**
 * A store deploy (ADR-0094): the Expo app built by EAS in the cloud from Foundry's checkout, then handed to the store.
 * iOS, preview or production: uploaded to App Store Connect, where it lands in TestFlight; the watch then follows it
 * (processing, in review once the person submits it there, live or rejected). Android preview: an APK to install,
 * from the build's page. Android production: submitted to Google Play's production track; Google tells nothing after.
 * The keys exist as files only while the commands run; the token reaches the CLI through its environment.
 */
async function runStore(engine: Engine, goal: Goal, dir: string, ref: string, provider: StoreProvider, production: boolean, fail: (reason: string) => void): Promise<void> {
  const { store } = engine;
  const c = storeCredentials(engine);
  const platform = STORE_PLATFORM[provider];
  const d = expoDeployability(dir, provider);
  if (!d.ok) return fail(d.reason);
  const app = d.app;
  const hide = redactor([c.expoToken, c.asc?.key, c.playServiceAccount].filter((v): v is string => !!v && v.length >= 6));
  const cwd = join(dir, app.dir);
  const env = easEnv(c.expoToken!);
  const eas = engine.deployCli('eas');
  const record = (label: string, argv: string[], exitCode: number | null, durationMs: number, out: string) => store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, target: null, label, command: hide(argv.join(' ')).split(dir).join('<deploy folder>'), exitCode, durationMs, outputTail: hide(out).slice(-3_000) } });
  const step = async (label: string, argv: string[], timeoutMs = STEP_TIMEOUT_MS) => {
    const t0 = Date.now();
    const r = await exec(argv, cwd, { timeoutMs, env });
    const out = plain(`${r.stdout}\n${r.stderr}`).trim();
    record(label, argv, r.code, Date.now() - t0, out);
    return { code: r.code, out, stdout: plain(r.stdout) };
  };
  const failed = (label: string, r: { code: number | null; out: string }) => {
    const hint = easFailureHint(r.out);
    return fail(`${label} failed (exit ${r.code}): ${hint ? `${hint} (${hide(lastWords(r.out))})` : hide(lastWords(r.out))}`);
  };
  // what the store needs before anything is built: the App Store Connect app behind the bundle id, the Play key for production
  let ascAppId: string | null = null;
  if (provider === 'appstore') {
    if (!c.asc) return fail('the App Store Connect API key is not in Settings (Git & delivery → Stores): the upload to TestFlight needs it');
    if (!app.dynamic) {
      let found: { id: string; name: string } | null;
      try {
        found = await ascApp(c.asc, app.bundleId!, engine.storeFetch);
      } catch (err) {
        return fail(String((err as Error).message ?? err));
      }
      if (!found) return fail(`App Store Connect has no app with the bundle id ${app.bundleId}: make it there first (My Apps → +, the same bundle id), then deploy again`);
      ascAppId = found.id;
    }
  }
  const sa = provider === 'play' && production ? (c.playServiceAccount ? parseServiceAccount(c.playServiceAccount) : null) : null;
  if (provider === 'play' && production && !sa) return fail('the Google Play service account key is not in Settings (Git & delivery → Stores): the submit to Google Play needs it');
  if (sa && !sa.ok) return fail(sa.reason);
  store.append({ type: 'deploy.started', goalId: goal.id, payload: { provider, target: null, production, ref, framework: `Expo (EAS) — ${platform === 'ios' ? 'iOS' : 'Android'}${app.name ? ` · ${app.name}` : ''}`, dir: app.dir } });
  for (const note of d.notes) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${note}` } });
  // a dynamic config is read by the CLI with the project's packages: installed in the checkout first
  if (app.dynamic) {
    const r = await step(`install the packages (${app.install.join(' ')})`, app.install);
    if (r.code !== 0) return failed('the install', r);
  }
  const profile = production ? FOUNDRY_PROFILE.production : FOUNDRY_PROFILE.preview;
  const run = async (keyPath: string | null) => {
    writeEasProfiles(cwd, { asc: provider === 'appstore' && c.asc && ascAppId && keyPath ? { appId: ascAppId, keyPath, keyId: c.asc.keyId, issuerId: c.asc.issuerId } : null, play: provider === 'play' && keyPath ? { keyPath } : null });
    // the build, started and watched: EAS builds in the cloud; its page is linked whatever happens
    const started = await step(`start the ${platform === 'ios' ? 'iOS' : 'Android'} build on EAS (${profile})`, [...eas, 'build', '--platform', platform, '--profile', profile, '--non-interactive', '--no-wait', '--json']);
    if (started.code !== 0) return failed('the EAS build', started);
    let build = parseEasBuild(started.stdout);
    if (!build) return fail('EAS started no build: its output is in the activity');
    const page = easBuildPage(build);
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: EAS build ${build.id} started${page ? ` — ${page}` : ''}` } });
    const until = Date.now() + BUILD_WAIT_MS;
    let views = 0;
    while (!EAS_BUILD_DONE.has(build.status) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, engine.easPollMs));
      const t0 = Date.now();
      const r = await exec([...eas, 'build:view', build.id, '--json'], cwd, { timeoutMs: 120_000, env });
      const next = parseEasBuild(plain(r.stdout));
      if (next) build = next;
      // the first look and the last are recorded; the ones between would only repeat "in progress"
      if (views++ === 0 || EAS_BUILD_DONE.has(build.status)) record(`the build on EAS (${build.status.toLowerCase().replace(/_/g, ' ')})`, [...eas, 'build:view', build.id, '--json'], r.code, Date.now() - t0, plain(`${r.stdout}\n${r.stderr}`).trim());
    }
    if (build.status !== 'FINISHED') return fail(build.status === 'ERRORED' || build.status === 'CANCELED' ? `the EAS build ${build.status.toLowerCase()}${build.error ? `: ${build.error}` : ''}${page ? ` — its logs: ${page}` : ''}` : `the EAS build was still ${build.status.toLowerCase().replace(/_/g, ' ')} after ${BUILD_WAIT_MS / 60_000} minutes; it goes on at EAS${page ? `: ${page}` : ''}`);
    const base = { platform, buildId: build.id, buildUrl: page, artifactUrl: build.artifacts.applicationArchiveUrl ?? build.artifacts.buildUrl, appVersion: build.appVersion, buildNumber: build.appBuildVersion, appId: provider === 'appstore' ? ascAppId : (app.package ?? null), submissionUrl: null as string | null, checkedAt: null as string | null };
    // an Android preview ends here: an APK to install, from the build's page
    if (provider === 'play' && !production) {
      store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, target: null, production, url: page ?? base.artifactUrl, store: { ...base, consoleUrl: page, state: 'built: an APK to install, from the build page', code: null, done: true } } });
      return;
    }
    const submitted = await step(`submit the build to ${provider === 'appstore' ? 'App Store Connect (TestFlight)' : 'Google Play (production track)'}`, [...eas, 'submit', '--platform', platform, '--profile', FOUNDRY_PROFILE.submit, '--id', build.id, '--non-interactive', '--wait'], 45 * 60_000);
    if (submitted.code !== 0) return failed('the submit', submitted);
    base.submissionUrl = easSubmissionUrl(submitted.out);
    const view = await exec([...eas, 'submit:view', '--platform', platform, '--json'], cwd, { timeoutMs: 120_000, env }).catch(() => null);
    const sub = view ? parseEasSubmission(plain(view.stdout)) : null;
    if (sub?.status && !/finished/i.test(sub.status)) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `deploy: EAS reports the submission as ${sub.status}` } });
    if (provider === 'appstore') {
      const standing = storeStanding(null, null, production);
      store.append({ type: 'deploy.submitted', goalId: goal.id, payload: { provider, target: null, production, store: { ...base, consoleUrl: ascConsoleUrl(ascAppId!, production), state: standing.state, code: standing.code, done: false } } });
    } else {
      store.append({ type: 'deploy.submitted', goalId: goal.id, payload: { provider, target: null, production, store: { ...base, consoleUrl: playConsoleUrl(), state: 'submitted to Google Play’s production track; Google reviews it and releases it when done — the Play Console shows where it stands, no API tells Foundry', code: null, done: true } } });
    }
  };
  if (provider === 'appstore') await withSecretFile(engine.config.dataDir, 'AuthKey.p8', c.asc!.key, run);
  else if (production) await withSecretFile(engine.config.dataDir, 'play-service-account.json', c.playServiceAccount!, run);
  else await run(null);
}

/**
 * Where the submitted iOS deploys stand (ADR-0094): App Store Connect asked for each build still in its hands —
 * processing, then in TestFlight, then the version's review once the person submits it there — and every change
 * recorded and told. Runs on the engine's timer and on a click; a deploy is left alone after 30 days.
 */
export async function checkStoreDeploys(engine: Engine, goalId?: string): Promise<number> {
  const c = storeCredentials(engine);
  if (!c.asc) return 0;
  let changes = 0;
  const goals = goalId ? [getGoal(engine.store.db, goalId)].filter((g): g is Goal => !!g) : listGoals(engine.store.db);
  for (const goal of goals) {
    for (const dep of goal.deployments ?? []) {
      if (dep.provider !== 'appstore' || dep.status !== 'submitted' || !dep.store || dep.store.done || !dep.store.appId) continue;
      const age = Date.now() - new Date(dep.at).getTime();
      let next: { status: 'submitted' | 'live' | 'failed'; url: string | null; reason: string | null; store: NonNullable<typeof dep.store> };
      try {
        if (age > 30 * 86_400_000) next = { status: 'submitted', url: null, reason: null, store: { ...dep.store, state: `${dep.store.state} — not watched any more after 30 days; see App Store Connect`, done: true, checkedAt: new Date().toISOString() } };
        else {
          const build = await ascBuild(c.asc, dep.store.appId, dep.store.buildNumber, dep.store.appVersion, engine.storeFetch);
          const version = build && build.processingState === 'VALID' ? await ascVersionFor(c.asc, dep.store.appId, build.id, engine.storeFetch) : null;
          const standing = storeStanding(build, version, dep.production);
          next = { status: standing.status, url: standing.status === 'live' && dep.production ? appStoreUrl(dep.store.appId) : null, reason: standing.status === 'failed' ? standing.state : null, store: { ...dep.store, state: standing.state, code: standing.code, done: standing.done, checkedAt: new Date().toISOString() } };
        }
      } catch (err) {
        engine.config.log(`[deploy] the store watch failed for ${goal.id}: ${String((err as Error).message ?? err)}`);
        continue;
      }
      if (next.store.state === dep.store.state && next.store.done === dep.store.done && next.status === dep.status) continue;
      engine.store.append({ type: 'deploy.store_changed', goalId: goal.id, payload: { provider: dep.provider, target: dep.target ?? null, production: dep.production, deployedAt: dep.at, ...next } });
      changes++;
    }
  }
  return changes;
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
  if (isStore(provider)) {
    const c = storeCredentials(engine);
    const goal = getGoal(engine.store.db, goalId);
    const tokenOk = !!c.expoToken;
    const items: ReadinessItem[] = [{ id: 'token', label: 'Expo token in Settings', ok: tokenOk, severity: 'error', detail: tokenOk ? 'set' : 'add it under Settings → Git & delivery → Stores (expo.dev → Account settings → Access tokens)', fix: tokenOk ? null : { settings: 'git' } }];
    const d = goal ? expoDeployability(codeDir(engine, goal), provider) : null;
    const app = d?.ok ? d.app : null;
    const cwd = goal ? join(codeDir(engine, goal), app?.dir ?? '') : process.cwd();
    const easCmd = `npx --yes ${EAS_CLI.pkg}`;
    if (app && goal) items.push({ id: 'linked', label: 'The app is linked to an EAS project', ok: !!app.projectId || app.dynamic, severity: 'error', detail: app.projectId ? `project ${app.projectId}` : app.dynamic ? 'the config is dynamic: checked when the build starts' : 'no extra.eas.projectId in app.json', fix: app.projectId || app.dynamic ? null : { command: `cd ${shellQuote(goal.repoPath)} && ${easCmd} init\n# links the app to an EAS project under your account and writes the id into app.json; commit it` } });
    if (tokenOk) {
      const who = await exec([...engine.deployCli('eas'), 'whoami'], cwd, { timeoutMs: 120_000, env: easEnv(c.expoToken!) }).catch(() => ({ code: 1, stdout: '', stderr: 'not run' }));
      const name = plain(who.stdout).trim().split('\n').at(-1) ?? '';
      items.push({ id: 'account', label: 'EAS answers the token', ok: who.code === 0, severity: 'error', detail: who.code === 0 ? `signed in as ${name || 'the token’s account'}` : `EAS refused it: ${lastWords(plain(`${who.stdout}\n${who.stderr}`))}`, fix: who.code === 0 ? null : { settings: 'git' } });
    }
    if (provider === 'appstore') {
      items.push({ id: 'asc', label: 'App Store Connect API key in Settings', ok: !!c.asc, severity: 'error', detail: c.asc ? `key ${c.asc.keyId}` : 'the key (.p8), its id and the issuer id: App Store Connect → Users and Access → Integrations', fix: c.asc ? null : { settings: 'git' } });
      if (c.asc && app?.bundleId) {
        const found = await ascApp(c.asc, app.bundleId, engine.storeFetch).then((a) => ({ a, err: null as string | null })).catch((err: Error) => ({ a: null, err: err.message }));
        items.push({ id: 'ascApp', label: `The app ${app.bundleId} in App Store Connect`, ok: !!found.a, severity: 'error', detail: found.a ? `${found.a.name} (id ${found.a.id})` : (found.err ?? 'no app with this bundle id yet: make it in App Store Connect (My Apps → +) with the same bundle id'), fix: found.a ? null : found.err ? { settings: 'git' } : { url: 'https://appstoreconnect.apple.com/apps' } });
      }
      if (tokenOk && app?.projectId && goal) {
        const prev = await exec([...engine.deployCli('eas'), 'build:list', '--platform', 'ios', '--status', 'finished', '--limit', '1', '--json', '--non-interactive'], cwd, { timeoutMs: 120_000, env: easEnv(c.expoToken!) }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
        const had = prev.code === 0 && !!parseEasBuild(plain(prev.stdout));
        items.push({ id: 'signing', label: 'iOS signing on EAS', ok: had, severity: 'warn', detail: had ? 'an iOS build finished on EAS before, so EAS holds the certificate and the profile' : 'no finished iOS build on EAS yet: the first one needs the signing set up once, with your Apple ID', fix: had ? null : { command: `cd ${shellQuote(goal.repoPath)} && ${easCmd} credentials --platform ios\n# signs in with your Apple ID once and lets EAS make the distribution certificate and the provisioning profile; Foundry never holds them` } });
      }
    } else {
      const sa = c.playServiceAccount ? parseServiceAccount(c.playServiceAccount) : null;
      items.push({ id: 'play', label: 'Google Play service account key in Settings (production only)', ok: !!sa?.ok, severity: 'warn', detail: sa?.ok ? sa.account.client_email : sa ? sa.reason : 'a preview (an APK to install) needs none; a production submit does: Google Cloud → IAM → Service accounts → Keys, JSON', fix: sa?.ok ? null : { settings: 'git' } });
      if (sa?.ok && app?.package) {
        const reach = await playAppReachable(sa.account, app.package, engine.storeFetch).catch((err: Error) => ({ ok: false as const, reason: err.message }));
        items.push({ id: 'playApp', label: `The app ${app.package} in the Play Console`, ok: reach.ok, severity: 'warn', detail: reach.ok ? 'the account reaches it' : reach.reason, fix: reach.ok ? null : { url: 'https://play.google.com/console/' } });
      }
    }
    return { ok: items.every((i) => i.ok || i.severity === 'warn'), items, at };
  }
  if (isPaas(provider)) {
    const c = paasCredentials(engine);
    const tokenOk = paasConfigured(provider, c);
    const items: ReadinessItem[] = [{ id: 'token', label: `${PAAS_LABEL[provider]} token in Settings`, ok: tokenOk, severity: 'error', detail: tokenOk ? 'set' : 'add it under Settings → Git & delivery → Platforms', fix: tokenOk ? null : { settings: 'git' } }];
    if (provider === 'fly') {
      const v = await exec([...engine.deployCli('fly'), 'version'], process.cwd(), { timeoutMs: 30_000 }).catch(() => ({ code: 127, stdout: '', stderr: 'not found' }));
      items.push({ id: 'cli', label: 'flyctl on this computer', ok: v.code === 0, severity: 'error', detail: v.code === 0 ? plain(v.stdout).trim().split('\n')[0] ?? 'found' : 'flyctl is not installed here: Fly.io deploys run its CLI from this computer', fix: v.code === 0 ? null : { url: 'https://fly.io/docs/flyctl/install/' } });
    }
    const goal = getGoal(engine.store.db, goalId);
    if (provider === 'render' && goal) {
      const remote = await git(['remote', 'get-url', 'origin'], goal.repoPath);
      const repo = renderRepoUrl(remote.code === 0 ? remote.stdout : null);
      items.push({ id: 'remote', label: 'The repository on GitHub', ok: !!repo, severity: 'error', detail: repo ? `${repo}; Render's GitHub app must be allowed on it (github.com/apps/render)` : 'no GitHub remote: Render deploys from GitHub, so a Local only goal has nothing for it', fix: repo ? null : { url: 'https://github.com/apps/render/installations/new' } });
      if (tokenOk && !c.renderOwner) {
        const r = await renderApi(c.renderApiKey!, { method: 'GET', path: '/owners?limit=1' }, engine.paasFetch).catch(() => ({ status: 0, data: null as unknown }));
        const owner = Array.isArray(r.data) ? ((r.data[0] as { owner?: { id?: string; name?: string } } | undefined)?.owner ?? null) : null;
        items.push({ id: 'key', label: 'Render answers the API key', ok: r.status === 200 && !!owner, severity: 'error', detail: r.status === 200 && owner ? `workspace ${owner.name ?? owner.id}` : r.status === 401 ? 'Render refused the key' : `Render answered ${r.status || 'nothing'}`, fix: r.status === 200 && owner ? null : { settings: 'git' } });
      }
    }
    if (goal) {
      const env = deployEnvView(engine, goal, provider);
      items.push({ id: 'env', label: 'Runtime variables', ok: env.missing.length === 0, severity: 'warn', detail: env.missing.length ? `${env.missing.length} key${env.missing.length === 1 ? '' : 's'} from the example files without a value here: ${env.missing.join(', ')} — set what the project needs online under Runtime variables on the card` : env.keys.length ? `${env.keys.length} set (${env.keys.join(', ')})` : 'none set, none listed in example files', fix: null });
    }
    return { ok: items.every((i) => i.ok || i.severity === 'warn'), items, at };
  }
  const server = serverFor(engine, target);
  const goal = getGoal(engine.store.db, goalId);
  const app = goal ? goalServerDeployability(engine, goal, server.mode) : null;
  const project = goal ? { name: deployName(goal), ports: app?.ok ? app.app.review.ports : [] } : null;
  const deps = { knownHosts: knownHostsFile(engine), ssh: engine.deploySsh, project, run: (argv: string[], cwd: string, opts: { timeoutMs: number }) => exec(argv, cwd, opts) };
  mkdirSync(dirname(deps.knownHosts), { recursive: true });
  const items = server.privateKey ? await withSecretFile(engine.config.dataDir, 'id_deploy', server.privateKey, (keyFile) => serverReadiness(server, { ...deps, keyFile })) : await serverReadiness(server, { ...deps, keyFile: null });
  // the runtime variables (ADR-0093): told, never blocking — example files list optional settings too
  if (goal) {
    const env = deployEnvView(engine, goal, `server:${server.id}`);
    items.push({ id: 'env', label: 'Runtime variables', ok: env.missing.length === 0, severity: 'warn', detail: env.missing.length ? `${env.missing.length} key${env.missing.length === 1 ? '' : 's'} from the example files without a value here: ${env.missing.join(', ')} — set what the project needs online under Runtime variables on the card` : env.keys.length ? `${env.keys.length} set (${env.keys.join(', ')})` : 'none set, none listed in example files', fix: null });
  }
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
