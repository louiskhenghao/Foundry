import type { Goal, Task } from '@foundry/core';
import { listTasks } from '@foundry/core';
import type { Engine } from '../engine.ts';

/**
 * Every task commit in the order it landed on the goal branch, with its stable stack position and whether a previous
 * delivery already merged it. Positions never shift when a task merges, so a re-run reuses the same branch names (and
 * therefore the same PRs). A fix-CI or review-fix commit is not an entry of its own: it was made on its PR's branch and
 * travels with it. The docs commit written when the goal finished comes last, as its own PR, when there is a stack.
 */
export function stackEntries(engine: Engine, goal: Goal): { task: Task; index: number; merged: boolean }[] {
  const { store } = engine;
  const events = store.listByGoal(goal.id, 5000);
  const mergedTaskIds = new Set(events.filter((e) => e.type === 'delivery.merged').map((e) => (e.payload as any).taskId as string | null).filter((x): x is string => !!x));
  const order: string[] = [];
  for (const e of events) {
    if (e.type !== 'task.committed') continue;
    const { taskId } = e.payload as { taskId: string };
    const i = order.indexOf(taskId);
    if (i >= 0) order.splice(i, 1);
    order.push(taskId);
  }
  const tasks = listTasks(store.db, goal.id);
  const committed = order
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t && !!t.commitRef && t.state === 'done' && t.origin !== 'delivery-fix' && t.origin !== 'review-fix');
  const docs = committed.length >= 2 ? docsTask(goal, events) : null;
  const reference = committed.length >= 2 ? referenceTasks(goal, events) : [];
  return [...reference, ...committed, ...(docs ? [docs] : [])].map((task, i) => ({ task, index: i + 1, merged: mergedTaskIds.has(task.id) }));
}

/**
 * The reference reports committed before Clarify (one per investigation; a second one edits the first's file, so each
 * commit is its own entry, in order), as task-shaped stack entries. They are the first commits on the goal branch.
 */
function referenceTasks(goal: Goal, events: { type: string; payload: unknown; ts: string }[]): Task[] {
  const out: Task[] = [];
  for (const e of events) {
    if (e.type !== 'goal.investigation_finished') continue;
    const p = e.payload as { status: string; docPath?: string | null; docRef?: string | null };
    if (p.status !== 'ok' || !p.docRef || !p.docPath || out.some((t) => t.commitRef === p.docRef)) continue;
    const title = `docs(reference): ${p.docPath}`;
    out.push({
      id: `${goal.id}:reference:${p.docRef.slice(0, 7)}`, goalId: goal.id, title, kind: 'chore', scope: 'docs', scenario: 'docs', area: null, tdd: 'inherit',
      spec: `The report of the investigation of this goal's references, written before Clarify: ${p.docPath}.`,
      dependsOn: [], relevantFiles: [p.docPath], parallelizable: false, retryBudget: 0, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'simple',
      state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: p.docRef, commitMessage: title, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: e.ts, updatedAt: e.ts,
    } satisfies Task);
  }
  return out;
}

/**
 * The docs commit made when the goal finished, as a task-shaped stack entry. The goal branch carries it on top of the
 * task commits; a stacked delivery only ships task commits, so without this entry it never reached the base branch.
 */
function docsTask(goal: Goal, events: { type: string; payload: unknown; ts: string }[]): Task | null {
  const e = [...events].reverse().find((x) => x.type === 'goal.docs_generated' && (x.payload as { status: string }).status === 'ok');
  if (!e) return null;
  const p = e.payload as { ref?: string | null; detail: string; files: string[] };
  // events written before the commit was recorded name it in their detail ("committed 9205544 (3 file(s))")
  const ref = p.ref ?? /committed ([0-9a-f]{7,40})\b/.exec(p.detail)?.[1] ?? null;
  if (!ref) return null;
  const title = `docs: ${goal.title}`;
  return {
    id: `${goal.id}:docs`, goalId: goal.id, title, kind: 'chore', scope: 'docs', scenario: 'docs', area: null, tdd: 'inherit',
    spec: `Documentation written when the goal finished: ${p.files.join(', ') || 'the goal\u2019s docs'}.`,
    dependsOn: [], relevantFiles: p.files, parallelizable: false, retryBudget: 0, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'simple',
    state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: ref, commitMessage: title, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: e.ts, updatedAt: e.ts,
  } satisfies Task;
}

/** Stack entries no delivery has merged yet. */
export const pendingStackEntries = (engine: Engine, goal: Goal) => stackEntries(engine, goal).filter((t) => !t.merged);
