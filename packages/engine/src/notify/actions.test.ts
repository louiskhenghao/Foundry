import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Brief, Escalation, EscalationAnswer, FeedbackPlan, Goal, InterviewQuestion } from '@foundry/core';
import {
  JsonDrafts,
  briefKeyboard,
  budgetOnApproval,
  escalationKeyboard,
  parsePress,
  press,
  pressTarget,
  questionKeyboard,
  reply,
  roundKeyboard,
  textTargetOf,
  type ActionHost,
  type Drafts,
  type Keyboard,
} from './actions.ts';

const GOAL = 'g_0mvdryqh900a954fm4';
const ESC = 'esc_0mvdryqh900a954fm4t';
const via = { channel: 'Telegram', who: '@ann' };

const esc = (over: Partial<Escalation> = {}): Escalation => ({
  id: ESC,
  goalId: GOAL,
  taskId: 't_1',
  attemptId: null,
  trigger: 'retries_exhausted',
  message: 'Task "add login" used 3 attempts',
  payload: {},
  state: 'open',
  answer: null,
  createdAt: '2026-10-18T00:00:00Z',
  answeredAt: null,
  suggestion: null,
  ...over,
});
const q = (key: string, text: string, options: string[], blocking = true): InterviewQuestion => ({ key, text, options, reason: '', dependsOn: null, blocking });
const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: GOAL,
    title: 'Add dark mode',
    state: 'clarifying',
    provider: 'claude',
    budgetPreset: 'auto',
    budgets: { maxCostUsd: null, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 },
    delegatedFrom: null,
    delegation: { allow: false, autoApprove: false },
    interview: {
      mode: 'auto',
      status: 'awaiting_answers',
      sessionId: 's1',
      rounds: [{ round: 1, questions: [q('R1Q1', 'Which database?', ['Postgres', 'SQLite']), q('R1Q2', 'Accounts?', ['none', 'email'], false)], answers: null, askedAt: '', answeredAt: null, finish: false, note: null }],
    },
    ...over,
  }) as unknown as Goal;
const brief = (over: Partial<Brief> = {}): Brief => ({ goalId: GOAL, understanding: 'Dark mode everywhere.', questions: [], tasks: [{ key: 'T1' }], costEstimateUsd: 2.1, timeEstimateMin: 40, ...over }) as unknown as Brief;
const plan: FeedbackPlan = { kind: 'fix', rationale: 'The header is unreadable in dark mode.', hint: null, fixTasks: [{ title: 'fix the header contrast', spec: 'raise it', relevantFiles: [] }], decision: null };

function memDrafts(): Drafts {
  const answers = new Map<string, Record<string, string>>();
  const notes = new Map<string, string>();
  const plans = new Map<string, { feedback: string; plan: FeedbackPlan }>();
  return {
    answers: (g, r) => ({ ...(answers.get(`${g}:${r}`) ?? {}) }),
    setAnswer: (g, r, k, v) => void answers.set(`${g}:${r}`, { ...(answers.get(`${g}:${r}`) ?? {}), [k]: v }),
    note: (g, r) => notes.get(`${g}:${r}`) ?? null,
    setNote: (g, r, v) => void (v ? notes.set(`${g}:${r}`, v) : notes.delete(`${g}:${r}`)),
    clearAnswers: (g, r) => {
      answers.delete(`${g}:${r}`);
      notes.delete(`${g}:${r}`);
    },
    plan: (id) => plans.get(id) ?? null,
    setPlan: (id, v) => void (v ? plans.set(id, v) : plans.delete(id)),
  };
}

/** a host that records what a chat asked the engine for */
function host(state: { esc?: Escalation; goal?: Goal; brief?: Brief; fail?: string } = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const notes: string[] = [];
  const h: ActionHost = {
    goal: (id) => (state.goal && state.goal.id === id ? state.goal : null),
    brief: () => state.brief ?? null,
    escalation: (id) => (state.esc && state.esc.id === id ? state.esc : null),
    answerEscalation: async (id, answer: EscalationAnswer) => {
      calls.push({ fn: 'answerEscalation', args: [id, answer] });
      if (state.fail) throw new Error(state.fail);
      if (state.esc) state.esc = { ...state.esc, state: 'answered', answer };
    },
    answerInterview: (goalId, answers, finish, note) => {
      calls.push({ fn: 'answerInterview', args: [goalId, answers, finish, note] });
      if (state.fail) throw new Error(state.fail);
    },
    approveBrief: async (goalId, budgets) => {
      calls.push({ fn: 'approveBrief', args: [goalId, budgets] });
      if (state.fail) throw new Error(state.fail);
    },
    classifyFeedback: async (goalId, text) => {
      calls.push({ fn: 'classifyFeedback', args: [goalId, text] });
      return plan;
    },
    resumeNow: (provider) => {
      calls.push({ fn: 'resumeNow', args: [provider] });
      return true;
    },
    note: (_goalId, message) => void notes.push(message),
    drafts: memDrafts(),
  };
  return { h, calls, notes, state };
}
const codes = (kb: Keyboard) => kb.flat().map((b) => b.data.split(':').at(-1));
const labels = (kb: Keyboard | undefined) => (kb ?? []).flat().map((b) => b.label);

describe('buttons', () => {
  test('every button a chat gets fits in 64 bytes and reads back as what it was made for', () => {
    const kbs = [
      ...(['retries_exhausted', 'permission_denial', 'budget_exceeded', 'boundary_action', 'milestone', 'delivery_failed'] as const).map((trigger) => escalationKeyboard(esc({ trigger }))),
      questionKeyboard(GOAL, 10, 7, { options: ['a'.repeat(200), 'b'] }, 'my own answer'),
      roundKeyboard(GOAL, 10),
      roundKeyboard(GOAL, 10, 'n'.repeat(300)),
      briefKeyboard(GOAL, brief()),
    ];
    for (const b of kbs.flat(2)) {
      expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
      expect(parsePress(b.data)).not.toBeNull();
    }
    expect(pressTarget(parsePress(`q:${GOAL}:10:7:w`)!)).toEqual({ kind: 'question', goalId: GOAL, round: 10, index: 7 });
    for (const junk of ['', 'evil', `e:${GOAL}`, 'e:../x:r', `q:${GOAL}:1:0:zz`, `r:${GOAL}:1:z`, 'u:gpt', `b:${GOAL}:a:extra`]) expect(parsePress(junk)).toBeNull();
  });

  test('a chat can deny a command outside the workspace but never approve one, nor resolve a merge by hand', () => {
    expect(codes(escalationKeyboard(esc({ trigger: 'boundary_action' })))).toEqual(['d']);
    const all = (['retries_exhausted', 'permission_denial', 'budget_exceeded', 'boundary_action', 'milestone', 'delivery_failed', 'brief_question'] as const).flatMap((trigger) => labels(escalationKeyboard(esc({ trigger }))));
    expect(all.some((l) => /approve|resolve/i.test(l))).toBe(false);
    expect(escalationKeyboard(esc({ trigger: 'brief_question' }))).toEqual([]);
    expect(escalationKeyboard(esc({ state: 'answered' }))).toEqual([]);
    // a goal review: Retry turns the findings into fix tasks, Skip accepts the goal as it is
    expect(labels(escalationKeyboard(esc({ taskId: null, payload: { kind: 'goal-review' } })))).toContain('✅ Accept as-is');
  });

  test('the recommended option is starred and the chosen one ticked; an answer of your own shows on its button', () => {
    expect(labels(questionKeyboard(GOAL, 1, 0, { options: ['Postgres', 'SQLite'] }, 'SQLite'))).toEqual(['⭐ Postgres', '✓ SQLite', '✍️ My own answer…']);
    expect(labels(questionKeyboard(GOAL, 1, 0, { options: ['Postgres'] }, 'MariaDB')).at(-1)).toBe('✓ ✍️ MariaDB');
  });

  test('a Brief with a blocking question left gets no Approve button', () => {
    expect(briefKeyboard(GOAL, brief({ questions: [{ text: 'Which?', blocking: true, answer: '' }] } as Partial<Brief>))).toEqual([]);
    expect(codes(briefKeyboard(GOAL, brief()))).toEqual(['a']);
  });
});

describe('answering an escalation', () => {
  test('Retry answers it as the Inbox does, says who did it, and leaves a status button', async () => {
    const { h, calls, notes } = host({ esc: esc() });
    const out = await press(h, `e:${ESC}:r`, via);
    expect(calls).toEqual([{ fn: 'answerEscalation', args: [ESC, { action: 'retry_with_hint', extraAttempts: 1 }] }]);
    expect(notes).toEqual(['Retried from Telegram by @ann']);
    expect(out.buttons![0]![0]!.label).toMatch(/^✓ Retried · \d\d:\d\d$/);
    expect(out.alert).toBeUndefined();
  });

  test('Abort asks first; No puts the answers back; Yes aborts', async () => {
    const { h, calls } = host({ esc: esc() });
    const ask = await press(h, `e:${ESC}:x`, via);
    expect(codes(ask.buttons!)).toEqual(['X', 'n']);
    expect(calls).toEqual([]);
    expect(codes((await press(h, `e:${ESC}:n`, via)).buttons!)).toEqual(['r', 'h', 's', 'x']);
    await press(h, `e:${ESC}:X`, via);
    expect(calls[0]!.args[1]).toEqual({ action: 'abort_goal' });
  });

  test('an answer the message never offered is refused, a forged confirmation too', async () => {
    const { h, calls } = host({ esc: esc() });
    for (const code of ['d', 'c', 'D', 'M', 'A', 'z']) expect((await press(h, `e:${ESC}:${code}`, via)).toast).toBe('That answer does not apply here.');
    const boundary = host({ esc: esc({ trigger: 'boundary_action' }) });
    expect((await press(boundary.h, `e:${ESC}:X`, via)).toast).toBe('That answer does not apply here.');
    expect([...calls, ...boundary.calls]).toEqual([]);
  });

  test('what the engine refuses is shown as an alert and the buttons stay', async () => {
    const { h } = host({ esc: esc(), fail: 'revert it there (git revert abc1234), then answer' });
    const out = await press(h, `e:${ESC}:s`, via);
    expect(out).toEqual({ toast: 'Not done: revert it there (git revert abc1234), then answer', alert: true });
  });

  test('an escalation answered elsewhere says so; a gone one loses its buttons', async () => {
    const { h, calls } = host({ esc: esc({ state: 'answered', answer: { action: 'skip_task' } }) });
    const out = await press(h, `e:${ESC}:r`, via);
    expect(out.toast).toBe('Already answered.');
    expect(labels(out.buttons)).toEqual(['✓ Skipped']);
    expect(calls).toEqual([]);
    expect((await press(host().h, `e:${ESC}:r`, via)).buttons).toEqual([]);
  });

  test('Retry with hint asks for words; the reply retries with them', async () => {
    const { h, calls } = host({ esc: esc() });
    const ask = await press(h, `e:${ESC}:h`, via);
    expect(ask.ask?.target).toEqual({ kind: 'hint', escId: ESC });
    const out = await reply(h, ask.ask!.target, '  use the fixture in test/data  ', via);
    expect(calls).toEqual([{ fn: 'answerEscalation', args: [ESC, { action: 'retry_with_hint', hint: 'use the fixture in test/data', extraAttempts: 1 }] }]);
    expect(out.update?.[0]?.target).toEqual({ kind: 'esc', id: ESC });
    // a reply straight to the escalation's message means the same
    expect(textTargetOf(host({ esc: esc() }).h, { kind: 'esc', id: ESC })).toEqual({ kind: 'hint', escId: ESC });
    expect(textTargetOf(host({ esc: esc({ trigger: 'budget_exceeded' }) }).h, { kind: 'esc', id: ESC })).toBeNull();
  });

  test('milestone feedback is read first, then applied with the plan the person saw', async () => {
    const { h, calls } = host({ esc: esc({ trigger: 'milestone', taskId: null }) });
    expect(textTargetOf(h, { kind: 'esc', id: ESC })).toEqual({ kind: 'feedback', escId: ESC });
    const read = await reply(h, { kind: 'feedback', escId: ESC }, 'the header is unreadable', via);
    expect(calls).toEqual([{ fn: 'classifyFeedback', args: [GOAL, 'the header is unreadable'] }]);
    expect(read.send?.[0]?.text).toContain('fix the header contrast');
    expect(codes(read.send![0]!.buttons)).toEqual(['a', 'n']);
    const applied = await press(h, `p:${ESC}:a`, via);
    expect(calls[1]).toEqual({ fn: 'answerEscalation', args: [ESC, { action: 'feedback', feedback: 'the header is unreadable', plan }] });
    expect(applied.update?.[0]).toMatchObject({ target: { kind: 'esc', id: ESC } });
    expect(h.drafts.plan(ESC)).toBeNull();
  });

  test('a dropped plan leaves the milestone waiting', async () => {
    const { h, calls } = host({ esc: esc({ trigger: 'milestone', taskId: null }) });
    await reply(h, { kind: 'feedback', escId: ESC }, 'too dark', via);
    const out = await press(h, `p:${ESC}:n`, via);
    expect(out.toast).toContain('still waits');
    expect(calls.filter((c) => c.fn === 'answerEscalation')).toEqual([]);
    expect(h.drafts.plan(ESC)).toBeNull();
  });
});

describe('answering an interview round', () => {
  test('picking an option keeps it as a draft until the round is sent', async () => {
    const { h, calls } = host({ goal: goal() });
    const out = await press(h, `q:${GOAL}:1:0:1`, via);
    expect(labels(out.buttons)).toEqual(['⭐ Postgres', '✓ SQLite', '✍️ My own answer…']);
    expect(h.drafts.answers(GOAL, 1)).toEqual({ R1Q1: 'SQLite' });
    expect(calls).toEqual([]);
    const sent = await press(h, `r:${GOAL}:1:s`, via);
    expect(calls).toEqual([{ fn: 'answerInterview', args: [GOAL, { R1Q1: 'SQLite' }, false, null] }]);
    expect(sent.update?.map((u) => labels(u.buttons))).toEqual([['✓ SQLite'], []]);
    expect(h.drafts.answers(GOAL, 1)).toEqual({});
  });

  test('Send names the blocking questions still open; Accept all recommended fills them; Enough sends what there is', async () => {
    const { h, calls } = host({ goal: goal() });
    const refused = await press(h, `r:${GOAL}:1:s`, via);
    expect(refused).toMatchObject({ alert: true, toast: expect.stringContaining('Q1') });
    await press(h, `q:${GOAL}:1:1:1`, via);
    await press(h, `r:${GOAL}:1:a`, via);
    expect(calls).toEqual([{ fn: 'answerInterview', args: [GOAL, { R1Q1: 'Postgres', R1Q2: 'email' }, false, null] }]);
    const other = host({ goal: goal() });
    await press(other.h, `r:${GOAL}:1:e`, via);
    expect(other.calls).toEqual([{ fn: 'answerInterview', args: [GOAL, {}, true, null] }]);
  });

  test('Add a note asks for words; the note waits with the answers, shows on the round, and goes with Send, Accept all or Enough', async () => {
    const { h, calls } = host({ goal: goal() });
    expect(labels(roundKeyboard(GOAL, 1))).toContain('✍️ Add a note…');
    const ask = await press(h, `r:${GOAL}:1:n`, via);
    expect(ask.ask?.target).toEqual({ kind: 'note', goalId: GOAL, round: 1 });
    // a reply to the round's own message means the same
    expect(textTargetOf(h, { kind: 'round', goalId: GOAL, round: 1 })).toEqual({ kind: 'note', goalId: GOAL, round: 1 });
    const kept = await reply(h, ask.ask!.target, '  Keep the old login page too  ', via);
    expect(h.drafts.note(GOAL, 1)).toBe('Keep the old login page too');
    expect(kept.update?.[0]).toMatchObject({ target: { kind: 'round', goalId: GOAL, round: 1 } });
    expect(labels(kept.update?.[0]?.buttons)).toContain('✓ ✍️ Keep the old login page too');
    expect(calls).toEqual([]);
    await press(h, `q:${GOAL}:1:0:0`, via);
    await press(h, `r:${GOAL}:1:s`, via);
    expect(calls).toEqual([{ fn: 'answerInterview', args: [GOAL, { R1Q1: 'Postgres' }, false, 'Keep the old login page too'] }]);
    expect(h.drafts.note(GOAL, 1)).toBeNull(); // sent with the answers, so no longer a draft
    const enough = host({ goal: goal() });
    await reply(enough.h, { kind: 'note', goalId: GOAL, round: 1 }, 'SQLite is fine', via);
    await press(enough.h, `r:${GOAL}:1:e`, via);
    expect(enough.calls).toEqual([{ fn: 'answerInterview', args: [GOAL, {}, true, 'SQLite is fine'] }]);
    // a closed round takes no note
    expect((await reply(host({ goal: goal({ state: 'awaiting_brief_approval' }) }).h, { kind: 'note', goalId: GOAL, round: 1 }, 'late', via)).alert).toBe(true);
  });

  test('a blocking question without options has no recommendation: Accept all says to answer it', async () => {
    const g = goal();
    g.interview!.rounds[0]!.questions = [q('R1Q1', 'Name of the product?', [])];
    const { h, calls } = host({ goal: g });
    expect((await press(h, `r:${GOAL}:1:a`, via)).toast).toContain('Q1 has no recommended answer');
    const own = await press(h, `q:${GOAL}:1:0:w`, via);
    expect(own.ask?.target).toEqual({ kind: 'answer', goalId: GOAL, round: 1, index: 0 });
    const noted = await reply(h, own.ask!.target, 'Lumen', via);
    expect(labels(noted.update?.[0]?.buttons)).toEqual(['✓ ✍️ Lumen']);
    await press(h, `r:${GOAL}:1:s`, via);
    expect(calls).toEqual([{ fn: 'answerInterview', args: [GOAL, { R1Q1: 'Lumen' }, false, null] }]);
  });

  test('a round that closed (answered on the page, a later round) takes no presses', async () => {
    for (const g of [goal({ state: 'awaiting_brief_approval' }), goal({ interview: { ...goal().interview!, status: 'thinking' } })]) {
      const { h, calls } = host({ goal: g });
      expect(await press(h, `q:${GOAL}:1:0:0`, via)).toEqual({ toast: 'This round is closed.', buttons: [] });
      expect(await press(h, `r:${GOAL}:1:s`, via)).toEqual({ toast: 'This round is closed.', buttons: [] });
      expect(calls).toEqual([]);
    }
    expect((await press(host({ goal: goal() }).h, `q:${GOAL}:2:0:0`, via)).toast).toBe('This round is closed.');
  });
});

describe('approving a Brief', () => {
  test('Approve asks first with the budget it sets; an Auto goal gets the estimate ×2, as on the Brief page', async () => {
    const { h, calls, notes } = host({ goal: goal({ state: 'awaiting_brief_approval' }), brief: brief() });
    const ask = await press(h, `b:${GOAL}:a`, via);
    expect(ask.toast).toBe('Approve and run with $4.5 / 80 min (the estimate ×2)?');
    expect(codes(ask.buttons!)).toEqual(['A', 'n']);
    expect(codes((await press(h, `b:${GOAL}:n`, via)).buttons!)).toEqual(['a']);
    const out = await press(h, `b:${GOAL}:A`, via);
    expect(calls).toEqual([{ fn: 'approveBrief', args: [GOAL, { maxCostUsd: 4.5, maxDurationMin: 80 }] }]);
    expect(out.toast).toBe('Approved: the goal starts.');
    expect(notes[0]).toContain('Brief approved from Telegram by @ann');
  });

  test('limits the goal already has stand; Codex sets no dollar limit', () => {
    const fixed = { provider: 'claude' as const, budgetPreset: 'custom' as const, budgets: { maxCostUsd: 10, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 } };
    expect(budgetOnApproval(fixed, brief())).toEqual({ text: '$10 / no time limit' });
    expect(budgetOnApproval({ ...goal(), provider: 'codex' }, brief())).toEqual({ budgets: { maxDurationMin: 80 }, text: '80 min (the estimate ×2)' });
  });

  test('nothing is approved past a blocking question, nor on a goal that moved on', async () => {
    const blocked = host({ goal: goal({ state: 'awaiting_brief_approval' }), brief: brief({ questions: [{ text: 'Which?', blocking: true, answer: '' }] } as Partial<Brief>) });
    expect((await press(blocked.h, `b:${GOAL}:A`, via)).toast).toContain('blocking question');
    const running = host({ goal: goal({ state: 'running' }), brief: brief() });
    expect((await press(running.h, `b:${GOAL}:A`, via)).toast).toBe('The goal is running: nothing to approve.');
    expect([...blocked.calls, ...running.calls]).toEqual([]);
  });
});

test('Resume now starts the paused sessions again', async () => {
  const { h, calls } = host();
  const out = await press(h, 'u:codex', via);
  expect(calls).toEqual([{ fn: 'resumeNow', args: ['codex'] }]);
  expect(out.toast).toContain('start again');
});

describe('drafts on disk', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  test('survive a restart, and the oldest go first past the cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-drafts-'));
    dirs.push(dir);
    const path = join(dir, 'notify', 'drafts.json');
    const a = new JsonDrafts(path);
    a.setAnswer(GOAL, 1, 'R1Q1', 'SQLite');
    a.setPlan(ESC, { feedback: 'too dark', plan });
    a.setNote(GOAL, 1, 'keep the old login page');
    const b = new JsonDrafts(path);
    expect(b.answers(GOAL, 1)).toEqual({ R1Q1: 'SQLite' });
    expect(b.note(GOAL, 1)).toBe('keep the old login page');
    expect(b.plan(ESC)).toEqual({ feedback: 'too dark', plan });
    b.clearAnswers(GOAL, 1);
    expect(new JsonDrafts(path).note(GOAL, 1)).toBeNull(); // the note goes with the answers it was written for
    for (let i = 0; i < 60; i++) b.setAnswer(`g_${i}`, 1, 'k', 'v');
    expect(new JsonDrafts(path).answers(GOAL, 1)).toEqual({});
  });
});
