/**
 * What the Explainer proposed (ADR-0075), applied by the person: a task of this goal, a decision for the rest of it, a
 * Note on the Brief, a Follow-up once the goal is over, or files given in the Conversation handed to a Request or a
 * material. Each is checked against the goal as it stands; nothing is applied twice.
 */
import type { Attachment, Check, Conversation, ConversationMessage, Goal, Proposal, Task } from '@foundry/core';
import { IdPrefix, getBrief, listChecks, listEscalations, listTasks, needsOf, newId, noteQuestion } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { ConversationError } from './conversations.ts';

const OVER = new Set(['done', 'over_delivered', 'failed', 'cancelled']);
const AT_WORK = new Set(['running', 'blocked', 'awaiting_feedback', 'goal_review']);

/** the attachments on the person's questions of this Conversation, by id */
const givenIn = (c: Conversation): Map<string, Attachment> => new Map(c.messages.filter((m) => m.role === 'person').flatMap((m) => m.attachments ?? []).map((a) => [a.id, a]));

export async function applyProposal(engine: Engine, goal: Goal, c: Conversation, m: ConversationMessage, p: Proposal, by: string | null): Promise<string> {
  const { store } = engine;
  if (p.applied) throw new ConversationError(`already applied: ${p.applied.result}`, 409);
  let result: string;
  switch (p.type) {
    case 'task': {
      if (!p.task) throw new ConversationError('the proposal names no task', 400);
      if (goal.state === 'awaiting_brief_approval' || goal.state === 'clarifying' || goal.state === 'draft') throw new ConversationError('the Brief is not approved yet: add it there as a Note (the Explainer can propose one)', 400);
      if (OVER.has(goal.state)) throw new ConversationError('the goal is over: start a Follow-up (the Explainer can propose one)', 400);
      const tasks = listTasks(store.db, goal.id);
      const byRef = (ref: string) => tasks.find((t) => t.id === ref) ?? tasks.find((t) => t.title.trim().toLowerCase() === ref.trim().toLowerCase());
      const deps: Task[] = [];
      for (const ref of p.task.dependsOn) {
        const t = byRef(ref);
        if (!t) throw new ConversationError(`no task "${ref}" to depend on`, 400);
        if (t.state === 'failed') throw new ConversationError(`"${t.title}" failed: a task after it would never run`, 400);
        deps.push(t);
      }
      const now = new Date().toISOString();
      const dependsOn = deps.length ? [...new Set(deps.map((t) => t.id))] : tasks.filter((t) => t.state === 'done' || t.state === 'skipped').map((t) => t.id);
      const task: Task = {
        id: newId(IdPrefix.task),
        goalId: goal.id,
        title: p.task.title,
        spec: `${p.task.spec}\n\n(From the Conversation: "${m.text.split('\n')[0]?.slice(0, 120) ?? ''}")`,
        kind: p.task.kind,
        scope: null,
        scenario: p.task.scenario,
        area: null,
        tdd: 'inherit',
        dependsOn,
        relevantFiles: p.task.relevantFiles,
        parallelizable: true,
        retryBudget: goal.budgets.attemptsPerTask,
        origin: 'conversation',
        milestone: null,
        milestoneVisits: 0,
        checkpointOf: null,
        difficulty: p.task.difficulty,
        state: 'pending',
        branch: null,
        worktreePath: null,
        baseRef: null,
        commitRef: null,
        commitMessage: null,
        hint: null,
        extraAttempts: 0,
        needs: [],
        delegatedGoalId: null,
        summary: null,
        createdAt: now,
        updatedAt: now,
      };
      store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
      // the goal's must commands, as a fix task gets them, and the checks the proposal brought
      for (const chk of listChecks(store.db, goal.id).filter((x) => x.taskId === null && x.tier === 'must' && x.spec.type === 'command')) {
        store.append({ type: 'check.created', goalId: goal.id, payload: { check: { ...chk, id: newId(IdPrefix.check), taskId: task.id } } });
      }
      for (const chk of p.task.checks) {
        const check: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: task.id, name: chk.name, tier: 'must', spec: { type: 'command', cmd: chk.cmd, timeoutMs: 60_000, expectExitCode: 0 } };
        store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
      }
      result = `task ${task.id}: ${task.title}`;
      break;
    }
    case 'decision': {
      if (!p.decision) throw new ConversationError('the proposal names no decision', 400);
      if (OVER.has(goal.state)) throw new ConversationError('the goal is over: a decision would bind nothing', 400);
      store.append({ type: 'brief.decision_added', goalId: goal.id, payload: { id: newId('q'), text: `From the Conversation: ${p.title}`, answer: p.decision.text } });
      const line = `Decision from the Conversation: ${p.decision.text}`;
      let told = 0;
      for (const t of listTasks(store.db, goal.id).filter((t) => t.state === 'pending' || t.state === 'ready')) {
        store.append({ type: 'task.hint_set', goalId: goal.id, payload: { taskId: t.id, hint: t.hint ? `${t.hint}\n${line}` : line, extraAttempts: 0 } });
        told++;
      }
      result = `decision recorded${told ? `, ${told} task${told === 1 ? '' : 's'} not yet started told` : ''}`;
      break;
    }
    case 'note': {
      if (!p.note) throw new ConversationError('the proposal has no note', 400);
      if (goal.state !== 'awaiting_brief_approval') throw new ConversationError('a Note goes on a Brief that awaits approval; this one is past that', 400);
      const b = getBrief(store.db, goal.id);
      if (!b) throw new ConversationError('no Brief yet', 400);
      engine.editBrief(goal.id, { ...b.brief, questions: [...b.brief.questions, noteQuestion(newId('q'), p.note.text)] });
      result = 'note added to the Brief; Revise there when you are ready';
      break;
    }
    case 'follow-up': {
      if (!p.followUp) throw new ConversationError('the proposal has no prompt', 400);
      result = `/goals/new?follows=${encodeURIComponent(goal.id)}&prompt=${encodeURIComponent(p.followUp.prompt)}`;
      break;
    }
    case 'fulfil': {
      if (!p.fulfil) throw new ConversationError('the proposal hands over nothing', 400);
      const given = givenIn(c);
      const files = p.fulfil.attachmentIds.map((id) => {
        const a = given.get(id);
        if (!a) throw new ConversationError(`no attachment ${id} in this Conversation`, 400);
        return a;
      });
      const note = p.fulfil.note?.trim() || null;
      if (p.fulfil.requestId) {
        const esc = listEscalations(store.db, { goalId: goal.id }).find((e) => e.id === p.fulfil!.requestId);
        if (!esc || !needsOf(esc)) throw new ConversationError('no such Request on this goal', 404);
        if (esc.state !== 'open') throw new ConversationError(`that Request is already ${esc.state}`, 409);
        await engine.answerEscalation(esc.id, { action: 'provide', hint: note ?? undefined, attachments: files }, by);
        result = `Request answered: ${needsOf(esc)!.what}`;
      } else if (p.fulfil.materialKey) {
        const material = (getBrief(store.db, goal.id)?.brief.provides ?? []).find((x) => x.key === p.fulfil!.materialKey);
        if (!material) throw new ConversationError('the Brief names no such material', 404);
        if (material.status !== 'waiting') throw new ConversationError(`${material.what} is already ${material.status}`, 409);
        engine.receiveMaterial(goal.id, material.key, { attachments: files, note, by });
        result = `${material.what}: received`;
      } else throw new ConversationError('the proposal names neither a Request nor a material', 400);
      break;
    }
  }
  store.append({ type: 'conversation.proposal_applied', goalId: goal.id, payload: { conversationId: c.id, messageId: m.id, proposalId: p.id, by, result } });
  engine.tick(goal.id);
  return result;
}
