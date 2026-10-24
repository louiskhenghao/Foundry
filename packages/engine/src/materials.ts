/**
 * Materials the person promised in the Brief, and the answers to Requests (ADR-0074): which of a task's materials are
 * still awaited in wait mode, what the person answered a worker's Request with, and what happens when a material
 * arrives — the Brief records it, the Requests waiting for it are answered, a placeholder gets its swap-in task.
 */
import type { Brief, BriefProvide, Escalation, Goal, Task } from '@foundry/core';
import { getTask, listEscalations, listTasks, needsOf } from '@foundry/core';
import { attachmentAbsPath } from './attachments.ts';
import type { RequestAnswer } from './attempt-loop.ts';
import type { Engine } from './engine.ts';
import { unblockGoalIfFree } from './escalation.ts';
import { createFixTasks } from './fix-tasks.ts';

/** the materials this task needs that are in wait mode and not here yet: the task does not start before they arrive */
export function materialsAwaited(brief: Brief | undefined, task: Task): BriefProvide[] {
  return (brief?.provides ?? []).filter((p) => (task.needs ?? []).includes(p.key) && p.mode === 'wait' && p.status === 'waiting');
}

/** the latest answered Request of a task, as the session that asked reads it; undefined when there is none */
export function requestAnswerFor(engine: Engine, goal: Goal, task: Task): RequestAnswer | undefined {
  const esc = listEscalations(engine.store.db, { goalId: goal.id })
    .filter((e) => e.trigger === 'needs_input' && e.taskId === task.id && e.state === 'answered' && e.answer)
    .at(-1);
  if (!esc?.answer) return undefined;
  const given = goal.attachments.filter((a) => a.requestId === esc.id);
  return {
    words: esc.answer.hint?.trim() || null,
    files: given.filter((a) => a.kind === 'file').map((a) => ({ name: a.name, path: attachmentAbsPath(engine.config.dataDir, goal.id, a) ?? a.name })),
    links: given.filter((a) => a.kind === 'link' && a.url).map((a) => a.url!),
    proceedWithout: esc.answer.action === 'proceed_without',
  };
}

/** the open Requests of a goal for one material, Foundry's or a worker's */
const requestsFor = (engine: Engine, goalId: string, key: string): Escalation[] => listEscalations(engine.store.db, { goalId, openOnly: true }).filter((e) => e.trigger === 'needs_input' && needsOf(e)?.materialKey === key);

/**
 * A material arrived (or the person has none, `waived`): the Brief records it, every Request waiting for it is answered
 * and its task goes on, and a task that built with a placeholder gets a swap-in task after it. `attachmentIds` are the
 * goal attachments that delivered it (already added, marked with the material).
 */
export function markMaterial(engine: Engine, goal: Goal, key: string, i: { attachmentIds: string[]; note: string | null; by: string | null; waived: boolean }): void {
  const { store } = engine;
  const brief = engine.briefOf(goal.id);
  const material = (brief?.provides ?? []).find((p) => p.key === key);
  if (!material) throw new Error(`the Brief names no material "${key}"`);
  store.append({ type: 'goal.material_received', goalId: goal.id, payload: { key, attachmentIds: i.attachmentIds, note: i.note, by: i.by, waived: i.waived } });
  for (const esc of requestsFor(engine, goal.id, key)) {
    store.append({ type: 'escalation.answered', goalId: goal.id, payload: { escalationId: esc.id, answer: { action: i.waived ? 'proceed_without' : 'provide', hint: i.note ?? undefined }, by: i.by } });
    const task = esc.taskId ? getTask(store.db, esc.taskId) : null;
    if (task?.state === 'blocked') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'blocked', to: 'ready', reason: i.waived ? `the person has no ${material.what}: it goes on without it` : `${material.what} arrived` } });
  }
  // a placeholder built before the real thing came: one task swaps it in, after everything done so far — unless the
  // goal is over, when only a Follow-up can
  if (!i.waived && material.mode === 'placeholder' && ['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `${material.what} arrived after the goal ended: a Follow-up goal can swap it in for the placeholder.` } });
  } else if (!i.waived && material.mode === 'placeholder') {
    const started = listTasks(store.db, goal.id).filter((t) => (t.needs ?? []).includes(key) && ['running', 'observing', 'merging', 'done'].includes(t.state));
    if (started.length) {
      const files = goal.attachments.filter((a) => i.attachmentIds.includes(a.id)).map((a) => (a.kind === 'link' ? a.url! : `${a.name} (under Attachments from the user)`));
      createFixTasks(engine, goal, [{ title: `Swap in ${material.what}`, spec: `The person provided ${material.what}${i.note ? ` (${i.note})` : ''}: ${files.join(', ') || 'see the attachments'}. Replace the placeholder that ${started.map((t) => `"${t.title}"`).join(', ')} built with — the real thing in its place, the same behaviour, nothing else changed.`, relevantFiles: [] }], null, { origin: 'material-swap', kind: 'chore' });
    }
  }
  unblockGoalIfFree(engine, goal.id);
  engine.tick(goal.id);
}
