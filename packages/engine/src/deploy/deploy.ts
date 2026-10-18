/**
 * Deploy (ADR-0041): a finished goal's web app, published to a host when the person asks — a preview address by
 * default, production when they say so. Only a web page or an all-in-one web app is deployed (deploy/detect.ts): never a
 * worker, a separate backend or a custom server.
 *
 * The deploy runs in a checkout of the goal's commit of its own (one folder per repository, named after the host
 * project, so the host's link and the installed packages stay between deploys), one command after another, each
 * recorded without its tokens. Nothing is pushed to the repository; the host gets the files, or the source it builds.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DeployProvider, Goal } from '@foundry/core';
import { getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { exec, git } from '../git/git.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { type Deployability, deployability } from './detect.ts';
import { CLI, PROVIDER_LABEL, SUPPORTS, type DeployCredentials, configured, deploySteps, deployedUrl, projectName, redact } from './providers.ts';

/** a goal is deployed once it is done: a failed or unfinished goal's branch is not a thing to publish */
export const DEPLOYABLE_STATES = new Set(['done', 'over_delivered']);
const STEP_TIMEOUT_MS = 20 * 60_000;

export function deployCredentials(engine: Engine): DeployCredentials {
  const d = engine.settings.values().delivery;
  return { vercelToken: d.vercelToken, vercelScope: d.vercelScope, netlifyToken: d.netlifyToken, netlifyTeam: d.netlifyTeam, cloudflareToken: d.cloudflareToken, cloudflareAccountId: d.cloudflareAccountId };
}

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

/** a checkout of `ref` in the deploy folder: made once, then moved; ignored files (installed packages, the host's link) stay */
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
  await git(['clean', '-fd'], dir);
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

/** what can be deployed of a goal now, read from its code (the goal's folder when it is still there, else its repository) */
export function goalDeployability(engine: Engine, goal: Goal): Deployability {
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  return deployability(existsSync(ws) ? ws : goal.repoPath);
}

/** the reason a host cannot take an app of this kind, or null when it can */
export function unsupported(provider: DeployProvider, d: Deployability): string | null {
  if (!d.ok || SUPPORTS[provider].includes(d.app.kind)) return null;
  return `${PROVIDER_LABEL[provider]} gets a folder of files from Foundry, and ${d.app.framework} renders on a server: deploy it to Vercel or Netlify.`;
}

/** the deploys running now, per goal (the engine waits for them when it stops) */
const running = new Map<string, Promise<void>>();
/** one deploy per repository folder at a time: they share it */
const folders = new Map<string, Promise<unknown>>();
export const deployWork = () => [...running.values()];
export const deploying = (goalId: string) => running.has(goalId);

/**
 * Start a deploy; what is wrong is thrown at once (a goal not done, a host not set up, a deploy already running),
 * the rest happens in the background and in the goal's events.
 */
export function startDeploy(engine: Engine, goalId: string, req: { provider: DeployProvider; production: boolean }): void {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  if (!DEPLOYABLE_STATES.has(goal.state)) throw new Error(`the goal is ${goal.state.replace(/_/g, ' ')}: only a finished goal is deployed`);
  if (!configured(req.provider, deployCredentials(engine))) throw new Error(`${PROVIDER_LABEL[req.provider]} is not set up: add its token in Settings → Git & delivery`);
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

async function run(engine: Engine, goal: Goal, dir: string, req: { provider: DeployProvider; production: boolean }): Promise<void> {
  const { store } = engine;
  const c = deployCredentials(engine);
  const { provider, production } = req;
  const fail = (reason: string) => void store.append({ type: 'deploy.failed', goalId: goal.id, payload: { provider, production, reason: redact(reason, c).slice(0, 1_000) } });
  try {
    const ref = await deployRef(goal);
    if (!ref) return fail(`neither the goal's branch (${goal.branch}) nor its base branch (${goal.baseBranch}) is in the repository any more`);
    await checkout(goal, dir, ref);
    const d = deployability(dir);
    if (!d.ok) return fail(d.reason);
    const refused = unsupported(provider, d);
    if (refused) return fail(refused);
    store.append({ type: 'deploy.started', goalId: goal.id, payload: { provider, production, ref, framework: d.app.framework, dir: d.app.dir } });
    for (const note of d.notes) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `deploy: ${note}` } });
    const cwd = join(dir, d.app.dir);
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
      const out = `${r.stdout}\n${r.stderr}`.trim();
      store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, label: step.label, command: redact(step.argv.join(' '), c), exitCode: r.code, durationMs: Date.now() - t0, outputTail: redact(out.slice(-3_000), c) } });
      if (r.code !== 0 && !(step.okIf && step.okIf.test(out))) return fail(`${step.label} failed (exit ${r.code}): ${out.split('\n').filter(Boolean).slice(-4).join(' · ').slice(0, 600)}`);
      last = r.stdout;
    }
    const url = deployedUrl(provider, last, production);
    if (!url) return fail(`${PROVIDER_LABEL[provider]} finished but named no address: its output is in the activity`);
    store.append({ type: 'deploy.finished', goalId: goal.id, payload: { provider, production, url } });
  } catch (err) {
    fail(String((err as Error)?.message ?? err));
  }
}

/** how a host's CLI is run: `npx` with the pinned major version (it is cached after the first deploy) */
export const npxCli = (p: DeployProvider): string[] => ['npx', '--yes', CLI[p].pkg];
