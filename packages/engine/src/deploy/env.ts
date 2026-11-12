/**
 * The runtime variables of a deploy (ADR-0093): what the project needs online — a database address, an API key — kept
 * per repository and per place (a server, Fly, Railway, Render), the way the previews' variables are kept per
 * repository: on this computer only, values never shown back to a page, sealed in a Transfer's Keys & secrets. They
 * reach the place at deploy time — a `.foundry.env` file the compose services read, the environment PM2 starts the
 * process with, the platform's own secrets store — and never the goal's folder where the coding agents work.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { ENV_KEY, PreviewEnvStore, checkoutEnv, exampleKeys, keyUsage } from '../preview/env.ts';
import { envHint } from '../preview/env-hints.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { shellQuote } from './server.ts';

/** the file under the data folder the deploy variables are kept in (the same shape as the previews' store) */
export const DEPLOY_ENV_FILE = 'deploy-env.json';
/** one place's variables for one repository: the store's key */
export const deployEnvKey = (repoPath: string, place: string) => `${repoPath}\u001f${place}`;
export const splitDeployEnvKey = (key: string): { repoPath: string; place: string } => {
  const at = key.lastIndexOf('\u001f');
  return at < 0 ? { repoPath: key, place: '' } : { repoPath: key.slice(0, at), place: key.slice(at + 1) };
};
/** the env file written into the checkout for a server deploy, read by the compose services and the PM2 process */
export const FOUNDRY_ENV_FILE = '.foundry.env';
/** the compose override that hands the env file to every service */
export const FOUNDRY_ENV_OVERRIDE = 'compose.foundry.env.yaml';

export const deployEnvStore = (engine: Engine) => new PreviewEnvStore(engine.config.dataDir, DEPLOY_ENV_FILE);

export interface DeployEnvView {
  repo: string;
  place: string;
  rev: number;
  keys: string[];
  checkout: { files: string[]; keys: string[] };
  example: { key: string; example: string; file: string; comment: string | null }[];
  /** example keys without a value here */
  missing: string[];
  /** keys the previews of this repository have that this place does not */
  fromPreview: string[];
  notes: Record<string, { comment: string | null; example: string | null; file: string | null; usedIn: string[]; hint: string | null; generate: 'secret' | null }>;
}

/** what a place's variables are for a goal: the keys set, the example files' keys without a value, what each name is */
export function deployEnvView(engine: Engine, goal: Goal, place: string): DeployEnvView {
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  const root = existsSync(ws) ? ws : goal.repoPath;
  const { rev, vars } = deployEnvStore(engine).get(deployEnvKey(goal.repoPath, place));
  const example = exampleKeys(root, []);
  const checkout = checkoutEnv(goal.repoPath, []);
  const missing = example.filter((e) => !(e.key in vars)).sort((a, b) => Number(!!a.example.trim()) - Number(!!b.example.trim())).map((e) => e.key);
  const preview = engine.preview.env.get(goal.repoPath).vars;
  const fromPreview = Object.keys(preview).filter((k) => !(k in vars)).sort();
  const names = [...new Set([...Object.keys(vars), ...example.map((e) => e.key)])];
  const usedIn = keyUsage(root, names);
  const notes = Object.fromEntries(
    names.map((k) => {
      const ex = example.find((e) => e.key === k);
      const hint = envHint(k);
      return [k, { comment: ex?.comment ?? null, example: ex?.example || null, file: ex?.file ?? null, usedIn: usedIn[k] ?? [], hint: hint?.text ?? null, generate: hint?.generate ?? null }];
    }),
  );
  return { repo: goal.repoPath, place, rev, keys: Object.keys(vars).sort(), checkout: { files: checkout.files, keys: Object.keys(checkout.vars).sort() }, example, missing, fromPreview, notes };
}

/** replace a place's set; null keeps a key's stored value (the page never has it) */
export function setDeployEnv(engine: Engine, goal: Goal, place: string, vars: Record<string, string | null>, rev: number): DeployEnvView {
  deployEnvStore(engine).set(deployEnvKey(goal.repoPath, place), vars, rev);
  return deployEnvView(engine, goal, place);
}

/** add the previews' variables of the repository that the place lacks; returns the keys added */
export function copyPreviewEnv(engine: Engine, goal: Goal, place: string): { added: string[]; view: DeployEnvView } {
  const added = deployEnvStore(engine).merge(deployEnvKey(goal.repoPath, place), engine.preview.env.get(goal.repoPath).vars);
  return { added, view: deployEnvView(engine, goal, place) };
}

/** add the checkout's untracked env files' variables that the place lacks (as the previews import them) */
export function importCheckoutDeployEnv(engine: Engine, goal: Goal, place: string): { added: string[]; view: DeployEnvView } {
  const added = deployEnvStore(engine).merge(deployEnvKey(goal.repoPath, place), checkoutEnv(goal.repoPath, []).vars);
  return { added, view: deployEnvView(engine, goal, place) };
}

/** the variables a deploy to `place` carries, and the values to blank out of its records */
export function deployVars(engine: Engine, goal: Pick<Goal, 'repoPath'>, place: string): Record<string, string> {
  return deployEnvStore(engine).get(deployEnvKey(goal.repoPath, place)).vars;
}

/** dotenv text for the env file: one `KEY=value` a line, the value single-quoted so a shell `source` and compose read it alike */
export function dotenvText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .filter(([k]) => ENV_KEY.test(k))
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join('\n')
    .concat('\n');
}

/**
 * Write the env file into a server deploy's checkout (owner-only), and for a compose project the override that gives
 * every service `env_file: .foundry.env`; returns the compose override's name when one was written.
 */
export function writeServerEnv(dir: string, vars: Record<string, string>, services: string[] | null): string | null {
  writeFileSync(join(dir, FOUNDRY_ENV_FILE), dotenvText(vars), { mode: 0o600 });
  if (!services) return null;
  const body = `# written by Foundry (Deploy): the runtime variables kept for this place reach every service of the project\nservices:\n${services.map((s) => `  ${s}:\n    env_file:\n      - ${FOUNDRY_ENV_FILE}\n`).join('')}`;
  writeFileSync(join(dir, FOUNDRY_ENV_OVERRIDE), body);
  return FOUNDRY_ENV_OVERRIDE;
}

/** every place's variables of every repository, grouped for a Transfer: repo → place → vars */
export function allDeployEnv(engine: Engine): Record<string, Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const [key, vars] of Object.entries(deployEnvStore(engine).all())) {
    const { repoPath, place } = splitDeployEnvKey(key);
    if (!place) continue;
    (out[repoPath] ??= {})[place] = vars;
  }
  return out;
}
