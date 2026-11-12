/**
 * Server recipes (ADR-0091): shell scripts that set a server up — Docker, nginx with HTTPS in front of the project,
 * Node.js and PM2, PostgreSQL, Redis — bundled with Foundry under packages/engine/recipes/server and modelled on the
 * scripts people already run on a fresh machine by hand, plus the person's own under the data folder
 * (`server-recipes/*.sh`). No model is involved: a recipe is the same text every time.
 *
 * A recipe never runs by itself. The card shows its whole text and what its header says it changes, the person fills
 * its inputs and confirms, and it runs once over ssh as root (`sudo -n`; a user who cannot sudo without a password is
 * told so and given the script to run themselves). Its inputs travel as environment lines prepended to the script on
 * stdin, never on a command line; a secret input is blanked out of the record. Every run is in the activity.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DeployServer, EngineEvent, RecipeParam, RecipeRun, ServerRecipe } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { runInGroup } from '../proc.ts';
import { knownHostsFile, serverFor } from './deploy.ts';
import { withSecretFile } from './secret-file.ts';
import { shellQuote, sshArgv } from './server.ts';

export const bundledRecipesDir = (engine: Engine) => join(engine.config.rootDir, 'packages', 'engine', 'recipes', 'server');
export const ownRecipesDir = (engine: Engine) => join(engine.config.dataDir, 'server-recipes');
const RUN_TIMEOUT_MS = 30 * 60_000;

/**
 * Read a recipe's header: `# foundry-recipe: <id>`, `# title:`, `# root: yes|no`, `# fixes: <readiness item>`,
 * `# param: NAME | label | default` (`secret` as the default marks a secret input with none), `# changes:` lines.
 * A script without the header (the person's own) is a recipe named after its file that says nothing of itself.
 */
export function parseRecipe(file: string, text: string, source: ServerRecipe['source']): ServerRecipe {
  const r: ServerRecipe = { id: basename(file).replace(/\.sh$/, ''), title: basename(file), root: true, fixes: null, params: [], changes: [], source, file, text };
  for (const line of text.split('\n')) {
    if (!line.startsWith('#')) {
      if (line.trim() === '' || line.startsWith('#!')) continue;
      break;
    }
    const m = line.match(/^#\s*([a-z-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'foundry-recipe':
        if (value!.trim()) r.id = value!.trim();
        break;
      case 'title':
        r.title = value!.trim();
        break;
      case 'root':
        r.root = !/^(no|false|0)$/i.test(value!.trim());
        break;
      case 'fixes':
        r.fixes = value!.trim() || null;
        break;
      case 'changes':
        if (value!.trim()) r.changes.push(value!.trim());
        break;
      case 'param': {
        const [name = '', label = '', dflt = ''] = value!.split('|').map((x) => x.trim());
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) break;
        const secret = dflt === 'secret';
        const p: RecipeParam = { name, label: label || name, default: secret || dflt === '' ? null : dflt, secret };
        r.params.push(p);
        break;
      }
    }
  }
  // an own script may name itself like a bundled one: its id says so, and the card shows both
  if (source === 'own' && !r.id.startsWith('own:')) r.id = `own:${r.id}`;
  return r;
}

const readDir = (dir: string, source: ServerRecipe['source']): ServerRecipe[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sh'))
    .sort()
    .map((f) => parseRecipe(join(dir, f), readFileSync(join(dir, f), 'utf8'), source));
};

/** every recipe a server can be set up with: Foundry's, then the person's own */
export function listRecipes(engine: Engine): ServerRecipe[] {
  return [...readDir(bundledRecipesDir(engine), 'bundled'), ...readDir(ownRecipesDir(engine), 'own')];
}
export function recipeById(engine: Engine, id: string): ServerRecipe | undefined {
  return listRecipes(engine).find((r) => r.id === id);
}

/** the recipe running on each server, if one (one at a time per server) */
const running = new Map<string, { recipe: string; title: string; at: string; done: Promise<void> }>();
export const recipeRunning = (serverId: string) => running.get(serverId) ?? null;
export const recipeWork = () => [...running.values()].map((r) => r.done);

/** the last lines of an output that say something */
const lastWords = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' · ')
    .slice(0, 500);

/**
 * Start a recipe on a server; what is wrong is thrown at once (no such server or recipe, no key, one already running),
 * the rest happens in the background and in the activity.
 */
export function startRecipe(engine: Engine, serverId: string, recipeId: string, params: Record<string, string>): void {
  const server = serverFor(engine, serverId);
  if (!server.privateKey) throw new Error(`the server ${server.name} has no SSH key: add it in Settings → Git & delivery`);
  const recipe = recipeById(engine, recipeId);
  if (!recipe) throw new Error(`no recipe named ${recipeId}`);
  if (running.has(serverId)) throw new Error(`a recipe is already running on ${server.name}: wait for it to end`);
  const at = new Date().toISOString();
  const done = run(engine, server, recipe, params)
    .catch(() => {})
    .finally(() => running.delete(serverId));
  running.set(serverId, { recipe: recipe.id, title: recipe.title, at, done });
}

async function run(engine: Engine, server: DeployServer, recipe: ServerRecipe, params: Record<string, string>): Promise<void> {
  const { store } = engine;
  const t0 = Date.now();
  const given = recipe.params.map((p) => p.name).filter((k) => typeof params[k] === 'string' && params[k] !== '');
  const base = { serverId: server.id, serverName: server.name, recipe: recipe.id, title: recipe.title };
  store.append({ type: 'server.recipe_started', goalId: null, payload: { ...base, params: given } });
  // a secret input is never in the record, however the script echoed it
  const secrets = recipe.params.filter((p) => p.secret).flatMap((p) => (params[p.name] && params[p.name]!.length >= 6 ? [params[p.name]!] : []));
  const redact = (s: string) => secrets.reduce((acc, v) => acc.split(v).join('***'), s);
  const finish = (status: 'ok' | 'failed', exitCode: number | null, output: string, reason: string | null) =>
    void store.append({ type: 'server.recipe_finished', goalId: null, payload: { ...base, status, exitCode, durationMs: Date.now() - t0, outputTail: redact(output).slice(-6_000), reason: reason && redact(reason).slice(0, 1_000) } });
  try {
    await withSecretFile(engine.config.dataDir, 'id_deploy', server.privateKey!, async (keyFile) => {
      const ssh = sshArgv(server, keyFile, knownHostsFile(engine), engine.deploySsh);
      const asRoot = server.user === 'root' || !recipe.root;
      if (!asRoot) {
        // nobody is there to type a password: a user who cannot sudo without one is told, and given the script
        const probe = await runInGroup([...ssh, 'sudo -n true'], { cwd: process.cwd(), timeoutMs: 60_000 });
        if (probe.code !== 0) return finish('failed', probe.code, `${probe.stdout}\n${probe.stderr}`.trim(), `${server.user} cannot run commands as root on ${server.host} without a password (sudo -n: ${lastWords(`${probe.stdout}\n${probe.stderr}`) || 'refused'}); run the script yourself there as root — copy it from the dialog — or give ${server.user} passwordless sudo`);
      }
      // the inputs as environment lines in front of the script, on stdin: the whole text is read first (`$(cat)`),
      // so a command inside that reads its own stdin cannot eat the rest of the script
      const script = `${given.map((k) => `export ${k}=${shellQuote(params[k]!)}`).join('\n')}\n${recipe.text}`;
      const r = await runInGroup([...ssh, `${asRoot ? 'bash' : 'sudo -n bash'} -c "$(cat)" < /dev/null`], { cwd: process.cwd(), timeoutMs: RUN_TIMEOUT_MS, stdin: script });
      const output = `${r.stdout}\n${r.stderr}`.trim();
      if (r.timedOut) return finish('failed', r.code, output, 'the script ran past 30 minutes and was stopped');
      if (r.code !== 0) return finish('failed', r.code, output, `the script failed (exit ${r.code}): ${lastWords(output)}`);
      return finish('ok', 0, output, null);
    });
  } catch (err) {
    finish('failed', null, '', String((err as Error)?.message ?? err));
  }
}

/** the runs of recipes on a server, newest first: the one running now, then what the activity holds */
export function recipeRuns(engine: Engine, serverId: string, limit = 20): RecipeRun[] {
  const now = running.get(serverId);
  const past = (engine.store.listByType('server.recipe_finished', 500) as (Extract<EngineEvent, { type: 'server.recipe_finished' }> & { seq: number })[])
    .filter((e) => e.payload.serverId === serverId)
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, limit)
    .map((e) => ({ serverId, recipe: e.payload.recipe, title: e.payload.title, status: e.payload.status, exitCode: e.payload.exitCode, reason: e.payload.reason, outputTail: e.payload.outputTail, at: new Date(new Date(e.ts).getTime() - e.payload.durationMs).toISOString(), endedAt: e.ts }));
  return [...(now ? [{ serverId, recipe: now.recipe, title: now.title, status: 'running' as const, exitCode: null, reason: null, outputTail: '', at: now.at, endedAt: null }] : []), ...past];
}
