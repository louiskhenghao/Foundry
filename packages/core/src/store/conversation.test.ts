import { describe, expect, test } from 'bun:test';
import { openDatabase } from './db.ts';
import { EventStore } from './event-store.ts';
import { applyEvent, clearReadModels, getConversation, getGoal, listConversations, upsertGoal } from './projections.ts';
import { IDLE_DELIVERY, type Goal, pendingQuestions } from '../schema/index.ts';

function goal(id: string): Goal {
  const now = new Date().toISOString();
  return {
    id, title: 't', prompt: 'p', workspaceDir: null, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null,
    revise: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/tmp/x', baseBranch: 'main', branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, conversationCostUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null,
    autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, qa: false, qaRun: null, docsRun: null, graphRun: null, artifactsRun: null },
    nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  };
}

describe('a Conversation on a goal (ADR-0073): events to read model', () => {
  test('started, asked and answered build the Conversation; the first question titles it; the answer keeps the session and the cost', () => {
    const store = new EventStore(openDatabase(':memory:'));
    store.append({ type: 'goal.created', goalId: 'g1', payload: { goal: goal('g1') } });
    store.append({ type: 'conversation.started', goalId: 'g1', payload: { conversationId: 'c1', by: 'ann' } });
    expect(listConversations(store.db, 'g1').map((c) => [c.id, c.title, c.by])).toEqual([['c1', '', 'ann']]);
    store.append({ type: 'conversation.asked', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm1', text: 'Why does the second task  depend on the first one, and not the other way round? It seems odd to me', by: 'ann' } });
    let c = getConversation(store.db, 'c1')!;
    // titled by the question's opening words, on one line and bounded
    expect(c.title.startsWith('Why does the second task depend on the first one')).toBe(true);
    expect(c.title.endsWith('…')).toBe(true);
    expect(c.title.length).toBeLessThanOrEqual(60);
    expect(c.title).not.toContain('  ');
    const title = c.title;
    expect(pendingQuestions(c).map((m) => m.id)).toEqual(['m1']);
    store.append({ type: 'conversation.answered', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm2', askedId: 'm1', text: 'Because the first task creates the table the second reads.', status: 'done', reason: null, costUsd: 0.4, costAvailable: true, model: 'sonnet', sessionId: 's9', durationMs: 12_000 } });
    c = getConversation(store.db, 'c1')!;
    expect(c.messages.map((m) => [m.role, m.id, m.askedId, m.status])).toEqual([['person', 'm1', null, null], ['explainer', 'm2', 'm1', 'done']]);
    expect(c.sessionId).toBe('s9');
    expect(c.costUsd).toBe(0.4);
    expect(pendingQuestions(c)).toEqual([]);
    // a failed answer with no session of its own keeps the one the Conversation has
    store.append({ type: 'conversation.asked', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm3', text: 'and the third?', by: null } });
    store.append({ type: 'conversation.answered', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm4', askedId: 'm3', text: '', status: 'failed', reason: 'spawn error', costUsd: 0, costAvailable: false, model: null, sessionId: null, durationMs: 0 } });
    c = getConversation(store.db, 'c1')!;
    expect(c.sessionId).toBe('s9');
    expect(c.costUsd).toBe(0.4);
    expect(c.title).toBe(title);
  });

  test("a Conversation's cost is the goal's, counted apart, and never its progress", () => {
    const store = new EventStore(openDatabase(':memory:'));
    store.append({ type: 'goal.created', goalId: 'g1', payload: { goal: goal('g1') } });
    const work = store.append({ type: 'goal.cost_added', goalId: 'g1', payload: { costUsd: 1.5, source: 'attempt:a1' } });
    store.append({ type: 'goal.cost_added', goalId: 'g1', payload: { costUsd: 0.25, source: 'conversation' } });
    const after = getGoal(store.db, 'g1')!;
    expect(after.costUsd).toBe(1.75);
    expect(after.conversationCostUsd).toBe(0.25);
    // the attempt's cost moved the goal's clock; the talk did not
    expect(after.updatedAt).toBe(work.ts);
    const before = after.updatedAt;
    store.append({ type: 'goal.cost_added', goalId: 'g1', payload: { costUsd: 0.1, source: 'conversation' } });
    expect(getGoal(store.db, 'g1')!.updatedAt).toBe(before);
  });

  test('a goal row from before the field reads with 0; deleting the goal drops its Conversations; a replay rebuilds them', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const { conversationCostUsd: _c, ...older } = goal('g0');
    upsertGoal(store.db, older as Goal);
    expect(getGoal(store.db, 'g0')!.conversationCostUsd).toBe(0);

    store.append({ type: 'goal.created', goalId: 'g1', payload: { goal: goal('g1') } });
    store.append({ type: 'conversation.started', goalId: 'g1', payload: { conversationId: 'c1', by: null } });
    store.append({ type: 'conversation.asked', goalId: 'g1', payload: { conversationId: 'c1', messageId: 'm1', text: 'hello?', by: null } });
    clearReadModels(store.db);
    expect(listConversations(store.db, 'g1')).toEqual([]);
    // replay the way the engine does: every event through the projections again
    for (const e of store.iterate()) applyEvent(store.db, e);
    expect(listConversations(store.db, 'g1').map((c) => c.title)).toEqual(['hello?']);
    store.append({ type: 'goal.deleted', goalId: 'g1', payload: { title: 't', deletedBranch: null, reason: 'test' } });
    expect(listConversations(store.db, 'g1')).toEqual([]);
  });
});
