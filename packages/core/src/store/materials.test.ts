import { describe, expect, test } from 'bun:test';
import { openDatabase } from './db.ts';
import { EventStore } from './event-store.ts';
import { getBrief, getGoal, getTask, upsertBrief, upsertTask } from './projections.ts';
import { IDLE_DELIVERY, type Brief, type Goal, type Task } from '../schema/index.ts';

const now = new Date().toISOString();
const goal = (id: string): Goal => ({
  id, title: 't', prompt: 'p', workspaceDir: null, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null,
  revise: null, interview: null, effort: null, videoPack: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/tmp/x', baseBranch: 'main', branch: `goal/${id}`,
  budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: null }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required', pace: 'thorough', ponytail: 'on' },
  models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, conversationCostUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null,
  autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
  completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, qa: false, qaRun: null, docsRun: null, graphRun: null, artifactsRun: null },
  nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
});
const brief = (provides: Brief['provides']): Brief => ({ goalId: 'g1', title: '', understanding: 'u', areas: [], assumptions: [], provides, checks: [], tasks: [], costEstimateUsd: 0, timeEstimateMin: 0, questions: [], styleOptions: [] });

describe('materials the person promised (ADR-0074): events to read model', () => {
  test('a material received or waived is recorded on the Brief, its attachments kept once; rows from before read as having none', () => {
    const store = new EventStore(openDatabase(':memory:'));
    store.append({ type: 'goal.created', goalId: 'g1', payload: { goal: goal('g1') } });
    upsertBrief(store.db, brief([{ key: 'M1', what: 'the logos', neededBy: ['T1'], mode: 'wait', status: 'waiting', receivedAt: null, attachmentIds: [], note: null }, { key: 'M2', what: 'the copy', neededBy: [], mode: 'placeholder', status: 'waiting', receivedAt: null, attachmentIds: [], note: null }]), true);
    store.append({ type: 'goal.material_received', goalId: 'g1', payload: { key: 'M1', attachmentIds: ['att1', 'att2'], note: 'final', by: 'ann', waived: false } });
    store.append({ type: 'goal.material_received', goalId: 'g1', payload: { key: 'M1', attachmentIds: ['att2', 'att3'], note: null, by: null, waived: false } });
    store.append({ type: 'goal.material_received', goalId: 'g1', payload: { key: 'M2', attachmentIds: [], note: 'there is none', by: 'ann', waived: true } });
    const [m1, m2] = getBrief(store.db, 'g1')!.brief.provides!;
    expect([m1!.status, m1!.note, m1!.attachmentIds]).toEqual(['received', 'final', ['att1', 'att2', 'att3']]);
    expect(m1!.receivedAt).toBeTruthy();
    expect([m2!.status, m2!.note]).toEqual(['waived', 'there is none']);
    // a Brief written before materials existed
    const raw = JSON.parse((store.db.query('SELECT data FROM briefs WHERE goal_id = ?').get('g1') as { data: string }).data);
    delete raw.provides;
    raw.tasks = [{ key: 'T1', title: 't', spec: 's', kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: true, relevantFiles: [], milestone: null }];
    store.db.query('UPDATE briefs SET data = ? WHERE goal_id = ?').run(JSON.stringify(raw), 'g1');
    const b = getBrief(store.db, 'g1')!.brief;
    expect(b.provides).toEqual([]);
    expect(b.tasks[0]!.needs).toEqual([]);
    // and a task row without `needs`
    const t = { id: 't1', goalId: 'g1', title: 't', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'pending', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as unknown as Task;
    upsertTask(store.db, t);
    expect(getTask(store.db, 't1')!.needs).toEqual([]);
    expect(getGoal(store.db, 'g1')).toBeTruthy();
  });
});
