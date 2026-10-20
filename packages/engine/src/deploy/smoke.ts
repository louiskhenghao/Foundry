/**
 * Smoke (ADR-0058): once a deploy ends live, the goal's milestone scripts run against the deployed address — each in the
 * deploy's checkout, through a config that leaves the project's own server out and points `baseURL` at the address — so
 * the person knows whether what went online does what the features showed. Every result stays on the deployment with
 * its videos and screenshots. A failed script is said, never mended: what differs online (an environment variable, a
 * database the host lacks) is the person's to fix; Smoke again tries once they did.
 */
import type { DeployProvider, Goal, SmokeScript, Task } from '@foundry/core';
import { listTasks } from '@foundry/core';
import { runMilestoneScript, type ScriptDeps } from '../checks/milestone-script.ts';
import { scriptDeps } from '../checks/walkthrough.ts';
import type { Engine } from '../engine.ts';

/** the deploy a smoke is about: `deployedAt` is the deployment's `at`, which names it on the goal */
export interface SmokeTarget {
  provider: DeployProvider;
  production: boolean;
  url: string;
  deployedAt: string;
}

/** the scripts a smoke tries: every landed task's milestone script, in plan order */
export function smokeScripts(engine: Engine, goalId: string): { task: Task; script: string }[] {
  return listTasks(engine.store.db, goalId)
    .filter((t) => t.milestoneScript && t.state === 'done')
    .map((t) => ({ task: t, script: t.milestoneScript! }));
}

/**
 * Run every milestone script against the address, in `dir` (a checkout of the deployed commit), and record the smoke on
 * the deployment: `deploy.smoke_started`, then `deploy.smoke_finished` with one result per script. Never throws: a
 * smoke that could not run is a failed one with the reason; a goal without scripts a skipped one.
 */
export async function runSmoke(engine: Engine, goal: Goal, dir: string, target: SmokeTarget, deps: ScriptDeps | undefined = scriptDeps.current): Promise<'pass' | 'fail' | 'skipped'> {
  const { store } = engine;
  const scripts = smokeScripts(engine, goal.id);
  if (!scripts.length) {
    store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { ...target, status: 'skipped', detail: 'the goal has no milestone scripts to try against it', scripts: [] } });
    return 'skipped';
  }
  store.append({ type: 'deploy.smoke_started', goalId: goal.id, payload: { ...target, scripts: scripts.map((s) => s.script) } });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const results: SmokeScript[] = [];
  let broke: string | null = null;
  try {
    for (const [i, { task, script }] of scripts.entries()) {
      const run = await runMilestoneScript(engine, goal, task, `smoke-${stamp}-${i + 1}-`, deps, { cwd: dir, against: target.url });
      results.push({ script, taskId: task.id, status: run.status, error: run.error, summary: run.summary, clips: run.clips, shots: run.shots, outputs: run.outputs, log: run.log });
      engine.config.log(`[smoke] ${goal.id}: ${script} ${run.status} against ${target.url}${run.error ? ` (${run.error.split('\n')[0]})` : ''}`);
    }
  } catch (err) {
    broke = String((err as Error)?.message ?? err);
  }
  const failed = results.filter((r) => r.status === 'fail');
  const n = scripts.length;
  const detail = broke
    ? `the smoke could not run: ${broke}`
    : failed.length
      ? `${failed.length} of ${n} script${n > 1 ? 's' : ''} failed against ${target.url}: ${failed.map((r) => `${r.script} — ${(r.error ?? 'failed').split('\n')[0]}`).join('; ')}`
      : `${n} script${n > 1 ? 's' : ''} passed against ${target.url}`;
  const status = broke || failed.length ? 'fail' : 'pass';
  store.append({ type: 'deploy.smoke_finished', goalId: goal.id, payload: { ...target, status, detail: detail.slice(0, 1_000), scripts: results } });
  return status;
}
