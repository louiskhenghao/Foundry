/**
 * Companion repositories (ADR-0063): a goal that must change more than one folder names the others, and the planner
 * gives each its part as a `goal` task bound to it — a Delegated goal in that repository, on that repository's own base
 * branch, that lands nothing on the main goal's branch (the tasks after it read its summary) and is delivered with the
 * main goal, with the same policy, as a pull request of its own.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getGoal, listTasks, type DeliveryPolicy, type Goal } from '@foundry/core';
import type { Engine } from './engine.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const FINISHED = new Set(['done', 'over_delivered']);

/** a short look at a companion for the Clarifier and the planner: what is at its top, its package and its README's first lines */
export function companionOverview(repoPath: string): string {
  const parts: string[] = [];
  try {
    const entries = readdirSync(repoPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
      .slice(0, 40);
    parts.push(`Top level: ${entries.join(', ') || '(empty)'}`);
  } catch {
    return '';
  }
  const pkg = join(repoPath, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string; scripts?: Record<string, string> };
      parts.push(`package.json: ${j.name ?? '(no name)'}${j.scripts ? `; scripts: ${Object.keys(j.scripts).slice(0, 12).join(', ')}` : ''}`);
    } catch {}
  }
  for (const name of ['README.md', 'readme.md', 'README']) {
    const p = join(repoPath, name);
    if (!existsSync(p)) continue;
    parts.push(`README:\n${clip(readFileSync(p, 'utf8').split('\n').slice(0, 20).join('\n').trim(), 1200)}`);
    break;
  }
  return parts.join('\n');
}

/** The `# Companion repositories` section of the Clarify and planner prompts; '' for a goal with none. */
export function renderCompanions(goal: Pick<Goal, 'companions' | 'repoPath'>): string {
  const companions = goal.companions ?? [];
  if (!companions.length) return '';
  const list = companions.map((c) => `## ${basename(c.repoPath)} — \`${c.repoPath}\` (branch ${c.baseBranch})\n${companionOverview(c.repoPath) || '(could not be read)'}`).join('\n\n');
  return `# Companion repositories\nThis goal changes other repositories besides this one (\`${goal.repoPath}\`). Each companion's part of the work is planned as ONE task of kind \`goal\` whose \`repo\` is that companion's path exactly as given below: a goal of its own does it there, on that repository's own branch, and nothing of it lands in this repository — the tasks after it read its summary. Tasks of this repository leave \`repo\` out. Understand each companion enough to say what must change there and how the parts fit: the interface between them belongs in the specs on both sides.\n\n${list}`;
}

/** The extras of a pull request body: for the main goal the companions and their pull requests; for a companion's goal, what it is part of. */
export function companionExtras(engine: Engine, goal: Goal): { companions?: string[]; partOf?: string } {
  const db = engine.store.db;
  if (goal.delegatedFrom) {
    const main = getGoal(db, goal.delegatedFrom.goalId);
    if (main && main.repoPath !== goal.repoPath) return { partOf: `Part of the goal "${goal.delegatedFrom.title}", whose main repository is ${basename(main.repoPath)}${main.delivery.pr ? ` (${main.delivery.pr.url})` : ''}; the other repositories it changes have pull requests of their own.` };
    return {};
  }
  if (!goal.companions?.length) return {};
  const notes: string[] = [];
  for (const t of listTasks(db, goal.id)) {
    if (!t.repo || !t.delegatedGoalId) continue;
    const d = getGoal(db, t.delegatedGoalId);
    if (!d) continue;
    notes.push(`${basename(d.repoPath)}: "${d.title}" on \`${d.branch}\`${d.delivery.pr ? ` — ${d.delivery.pr.url}` : ' — its pull request is opened with this one'}`);
  }
  return notes.length ? { companions: notes } : {};
}

/** When the main goal is delivered, each companion's Delegated goal is delivered the same way, in its own repository. */
export async function deliverCompanions(engine: Engine, goal: Goal, policy: DeliveryPolicy, source: 'deliver' | 'retry' | 'resume' | 'review'): Promise<void> {
  if (!goal.companions?.length || policy.mode === 'local') return;
  const db = engine.store.db;
  for (const t of listTasks(db, goal.id)) {
    if (!t.repo || !t.delegatedGoalId) continue;
    const d = getGoal(db, t.delegatedGoalId);
    if (!d || !FINISHED.has(d.state) || d.delivery.status === 'running') continue;
    try {
      await engine.deliver(d.id, { ...policy, baseBranch: null, remoteUrl: null, createRepo: null }, source);
      engine.store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `the companion ${basename(d.repoPath)} is delivered with this goal, by its delegated goal "${d.title}" (${policy.mode})` } });
    } catch (err) {
      engine.store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `the companion ${basename(d.repoPath)} could not be delivered: ${String((err as Error).message ?? err)}` } });
    }
  }
}
