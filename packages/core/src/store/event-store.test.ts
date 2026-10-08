import { describe, expect, test } from 'bun:test';
import { openDatabase } from './db.ts';
import { EventStore } from './event-store.ts';
import { getGoal, getTask, listTasks } from './projections.ts';
import { IDLE_DELIVERY, type Goal, type Task } from '../schema/index.ts';

function goal(id: string): Goal {
  const now = new Date().toISOString();
  return {
    id,
    title: 't',
    prompt: 'p',
    workspaceDir: null,
    checkpoint: null,
    selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null,
    interview: null,
    effort: null, modelPreset: null, modelSubstitutions: {},
    repoPath: '/tmp/x',
    baseBranch: 'main',
    branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 },
    budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'draft',
    stateBeforeBlock: null,
    costUsd: 0,
    fixCycles: 0,
    delivery: IDLE_DELIVERY,
    attachments: [],
    baseSync: null,
    autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null },
    nature: 'auto',
    outputDir: null,
    runningSince: null,
    createdAt: now,
    updatedAt: now,
  };
}
function task(id: string, goalId: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    goalId,
    kind: 'feature',
    scope: null,
    scenario: 'general',
    area: null, tdd: 'inherit',
    baseRef: null,
    commitRef: null,
    commitMessage: null,
    title: 'task',
    spec: 'do it',
    dependsOn: [],
    relevantFiles: [],
    parallelizable: true,
    retryBudget: 3,
    origin: 'brief',
    milestone: null,
    milestoneVisits: 0,
    checkpointOf: null, difficulty: 'standard' as const,
    state: 'pending',
    branch: null,
    worktreePath: null,
    hint: null,
    extraAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('EventStore', () => {
  test('append projects and replay reproduces identical read models', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = goal('g_1');
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'goal.state_changed', goalId: g.id, payload: { from: 'draft', to: 'clarifying', reason: 'test' } });
    store.append({ type: 'task.created', goalId: g.id, payload: { task: task('t_1', g.id) } });
    store.append({ type: 'task.state_changed', goalId: g.id, payload: { taskId: 't_1', from: 'pending', to: 'ready', reason: 'deps done' } });
    store.append({ type: 'goal.cost_added', goalId: g.id, payload: { costUsd: 0.25, source: 'test' } });

    expect(getGoal(store.db, g.id)?.state).toBe('clarifying');
    expect(getGoal(store.db, g.id)?.costUsd).toBe(0.25);
    expect(getTask(store.db, 't_1')?.state).toBe('ready');
    expect(listTasks(store.db, g.id)).toHaveLength(1);

    const before = store.snapshotReadModels();
    const n = store.replay();
    expect(n).toBe(5);
    expect(store.snapshotReadModels()).toEqual(before);
  });

  test("the Clarify step is kept while a session runs and cleared when a new one begins or the Brief is out", () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = { ...goal('g_2'), interview: { mode: 'auto' as const, depth: 5, status: 'awaiting_answers' as const, sessionId: 's', rounds: [{ round: 1, questions: [], answers: null, askedAt: '2026-01-01', answeredAt: null, finish: false }] } };
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'planning' } });
    expect(getGoal(store.db, g.id)?.clarifyStage?.stage).toBe('planning');
    store.append({ type: 'interview.round_answered', goalId: g.id, payload: { round: 1, answers: {}, finish: false } });
    expect(getGoal(store.db, g.id)?.clarifyStage).toBeNull();
    store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'clarifying' } });
    store.append({ type: 'goal.reclarified', goalId: g.id, payload: { reason: 'test', decisions: '', workspaceRebuilt: false } });
    expect(getGoal(store.db, g.id)?.clarifyStage).toBeNull();
    // a fresh Clarify keeps how deep the goal asked to be interviewed
    expect(getGoal(store.db, g.id)?.interview).toMatchObject({ depth: 5, rounds: [], sessionId: null });
  });

  test('rejects invalid payloads', () => {
    const store = new EventStore(openDatabase(':memory:'));
    // @ts-expect-error invalid state
    expect(() => store.append({ type: 'goal.state_changed', goalId: 'g', payload: { from: 'draft', to: 'nope', reason: '' } })).toThrow();
  });

  test('notifies listeners after commit', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const seen: string[] = [];
    store.subscribe((e) => seen.push(e.type));
    store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: 'hi' } });
    expect(seen).toEqual(['engine.note']);
  });
});

describe('listByGoalOfTypes', () => {
  test('finds a goal\'s events of the given types however many came after them', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = goal('g_types');
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'task.created', goalId: g.id, payload: { task: task('t_1', g.id) } });
    store.append({ type: 'goal.milestone_passed', goalId: g.id, payload: { taskId: 't_1', lookFor: 'the page' } });
    for (let i = 0; i < 400; i++) store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'planning' } });
    expect(store.listByGoal(g.id, 300).some((e) => e.type === 'goal.milestone_passed')).toBe(false);
    expect(store.listByGoalOfTypes(g.id, ['goal.milestone_passed', 'goal.checkpoint_opened']).map((e) => e.type)).toEqual(['goal.milestone_passed']);
    expect(store.listByGoalOfTypes('g_other', ['goal.milestone_passed'])).toEqual([]);
    expect(store.listByGoalOfTypes(g.id, [])).toEqual([]);
  });
});

describe('working time', () => {
  test('counts Clarify and the run, not the waits for the person', async () => {
    const { applyEvent } = await import('./projections.ts');
    const db = openDatabase(':memory:');
    const g = { ...goal('g_clock'), interview: { mode: 'always' as const, depth: 2, status: 'thinking' as const, sessionId: null, rounds: [] }, activeMs: 0, activeSince: null };
    let n = 0;
    // minute m after the start
    const at = (m: number, type: string, payload: unknown) => applyEvent(db, { id: `e${n++}`, ts: new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString(), goalId: g.id, type, payload } as never);
    const state = (m: number, from: string, to: string) => at(m, 'goal.state_changed', { from, to, reason: 't' });
    at(0, 'goal.created', { goal: g });
    state(0, 'draft', 'clarifying'); // works 0–2
    at(2, 'interview.round_asked', { round: 1, sessionId: null, questions: [] }); // the person answers 2–10
    at(10, 'interview.round_answered', { round: 1, answers: {}, finish: true }); // works 10–13
    state(13, 'clarifying', 'awaiting_brief_approval'); // the person reads the Brief 13–40
    state(40, 'awaiting_brief_approval', 'running'); // works 40–50
    state(50, 'running', 'awaiting_feedback'); // a milestone pause 50–70
    state(70, 'awaiting_feedback', 'running'); // works 70–75
    state(75, 'running', 'blocked'); // an Inbox question 75–90
    state(90, 'blocked', 'running'); // works 90–95
    state(95, 'running', 'done');
    const done = getGoal(db, g.id)!;
    expect(done.activeMs).toBe((2 + 3 + 10 + 5 + 5) * 60_000);
    expect(done.activeSince).toBeNull();
    const { budgetStatus } = await import('../../../engine/src/budget.ts');
    expect(budgetStatus(done).elapsedMin).toBe(25);
    // a goal from before the clock keeps its time from the start of the run
    expect(budgetStatus({ ...done, activeMs: undefined, activeSince: undefined, runningSince: new Date(Date.UTC(2026, 0, 1, 0, 40)).toISOString(), updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 95)).toISOString() }).elapsedMin).toBe(55);
  });
});

describe('Transfer (ADR-0030)', () => {
  const t0 = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
  const imported = (overrides: Partial<{ unfinished: boolean; remap: Record<string, string> }> = {}) => ({
    transferId: 'tr_1',
    from: { release: '1.2.0', hostname: 'old-mac', exportedAt: t0(30) },
    unfinished: true,
    bundle: 'transfer/tr_1/g_i.bundle',
    artifacts: null,
    transcripts: true,
    remap: { '/old/data/transcripts': '/new/data/transcripts', '/old/data/check-output': '/new/data/check-output' },
    ...overrides,
  });
  /** a running goal with a task in a worktree, one attempt with a transcript and a check result with raw output */
  function seedRunning(store: EventStore, id = 'g_i') {
    const g = { ...goal(id), workspaceDir: '/old/repo-foundry/x', outputDir: '/old/out', repoPath: '/old/repo', activeMs: 0, activeSince: null };
    const rows = [
      { type: 'goal.created', payload: { goal: g } },
      { type: 'goal.state_changed', payload: { from: 'draft', to: 'running', reason: 't' } },
      { type: 'task.created', payload: { task: task('t_i', id) } },
      { type: 'task.workspace_assigned', payload: { taskId: 't_i', branch: 'task/t_i', worktreePath: '/old/repo-foundry/.foundry/x/tasks/t_i' } },
      { type: 'attempt.started', payload: { attempt: { id: 'a_i', goalId: id, taskId: 't_i', index: 1, kind: 'work', sessionId: 's', model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: 7, cwd: '/old/repo-foundry/.foundry/x/tasks/t_i', transcriptPath: '/old/data/transcripts/a_i.jsonl', startedAt: t0(5), endedAt: null } } },
      { type: 'check.finished', payload: { result: { id: 'cr_i', checkId: 'c_i', goalId: id, taskId: 't_i', attemptId: 'a_i', status: 'fail', summary: 's', rawRef: '/old/data/check-output/cr_i.txt', durationMs: 1, at: t0(6) } } },
    ].map((e, i) => ({ id: `${id}_e${i}`, ts: t0(i), goalId: id, ...e }));
    store.importGoalEvents(id, rows);
    return g;
  }

  test('imported events keep their ids and times, project like their source and replay to the same read models', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const heard: string[] = [];
    store.subscribe((e) => heard.push(e.type));
    seedRunning(store);
    expect(heard).toEqual([]); // history is not news: no ticks, no notifications
    expect(store.listByGoal('g_i').map((e) => [e.id, e.ts])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [`g_i_e${i}`, t0(i)]));
    expect(getGoal(store.db, 'g_i')?.state).toBe('running');
    store.append({ type: 'goal.imported', goalId: 'g_i', payload: imported() });
    const before = store.snapshotReadModels();
    store.replay();
    expect(store.snapshotReadModels()).toEqual(before);
  });

  test('an Imported Goal is history: the other computer\'s folders are let go, data-dir paths remapped and the clock stopped at export', async () => {
    const { listAttemptsByGoal, listCheckResultsByGoal } = await import('./projections.ts');
    const { isHistory } = await import('../schema/goal.ts');
    const store = new EventStore(openDatabase(':memory:'));
    seedRunning(store);
    store.append({ type: 'goal.imported', goalId: 'g_i', payload: imported() });
    const g = getGoal(store.db, 'g_i')!;
    expect(isHistory(g)).toBe(true);
    expect(g.transfer).toMatchObject({ transferId: 'tr_1', unfinished: true, original: { repoPath: '/old/repo', workspaceDir: '/old/repo-foundry/x', outputDir: '/old/out' }, repoMapped: null, reattachedAt: null });
    expect([g.workspaceDir, g.outputDir, g.repoPath]).toEqual([null, null, '/old/repo']);
    // working from minute 1 (running) to the export at minute 30
    expect([g.activeMs, g.activeSince]).toEqual([29 * 60_000, null]);
    expect(getTask(store.db, 't_i')).toMatchObject({ worktreePath: null, branch: null });
    expect(listAttemptsByGoal(store.db, 'g_i')[0]!.transcriptPath).toBe('/new/data/transcripts/a_i.jsonl');
    expect(listCheckResultsByGoal(store.db, 'g_i')[0]!.rawRef).toBe('/new/data/check-output/cr_i.txt');
    // more events (the cut-off attempt being concluded) do not start the clock again
    store.append({ type: 'goal.state_changed', goalId: 'g_i', payload: { from: 'running', to: 'running', reason: 't' } });
    expect(getGoal(store.db, 'g_i')?.activeSince).toBeNull();
  });

  test('mapping the repository, restoring the branch and Reattaching move the goal back to work', () => {
    const store = new EventStore(openDatabase(':memory:'));
    seedRunning(store);
    store.append({ type: 'goal.imported', goalId: 'g_i', payload: imported() });
    store.append({ type: 'goal.repo_mapped', goalId: 'g_i', payload: { from: '/old/repo', to: '/new/repo', how: 'chosen' } });
    store.append({ type: 'goal.branch_restored', goalId: 'g_i', payload: { branch: 'goal/g_i', head: 'abc' } });
    let g = getGoal(store.db, 'g_i')!;
    expect(g.repoPath).toBe('/new/repo');
    expect(g.transfer).toMatchObject({ repoMapped: { to: '/new/repo', how: 'chosen' }, branchRestored: { head: 'abc' }, reattachedAt: null });
    store.append({ type: 'goal.reattached', goalId: 'g_i', payload: { workspaceDir: '/new/repo-foundry/x' } });
    g = getGoal(store.db, 'g_i')!;
    expect(g.workspaceDir).toBe('/new/repo-foundry/x');
    expect(g.transfer?.reattachedAt).toBeTruthy();
    expect(g.activeSince).toBeTruthy(); // running again: the clock runs
  });

  test('a goal whose events are already here — alive or deleted — is refused, and a bad row imports nothing', () => {
    const store = new EventStore(openDatabase(':memory:'));
    seedRunning(store);
    expect(store.hasGoalEvents('g_i')).toBe(true);
    expect(() => seedRunning(store)).toThrow(/already/);
    store.append({ type: 'goal.deleted', goalId: 'g_i', payload: { title: 't', deletedBranch: null, reason: 't' } });
    expect(() => seedRunning(store)).toThrow(/already/);
    const n = store.count();
    expect(() => store.importGoalEvents('g_x', [{ id: 'x1', ts: t0(0), goalId: 'g_x', type: 'goal.created', payload: { goal: goal('g_x') } }, { id: 'x2', ts: t0(1), goalId: 'g_x', type: 'no.such', payload: {} }])).toThrow();
    expect(() => store.importGoalEvents('g_y', [{ id: 'y1', ts: t0(0), goalId: 'g_other', type: 'goal.created', payload: { goal: goal('g_y') } }])).toThrow(/belongs/);
    expect(store.count()).toBe(n);
    expect(getGoal(store.db, 'g_x')).toBeNull();
  });
});
