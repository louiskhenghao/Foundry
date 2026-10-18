import { describe, expect, test } from 'bun:test';
import type { Brief, EngineEvent, Escalation, Goal } from '@foundry/core';
import { compose, composeBriefReady, composeEscalation } from './dispatcher.ts';

const title = (goalId: string | null) => (goalId === 'g1' ? 'Add dark mode' : (goalId ?? ''));
const ev = (type: string, payload: object, goalId: string | null = 'g1') => ({ id: 'ev1', ts: '2026-08-28T00:00:00Z', goalId, type, payload }) as EngineEvent;

describe('compose', () => {
  test('goal endings notify — done, over_delivered, failed', () => {
    const done = compose(ev('goal.state_changed', { from: 'goal_review', to: 'done', reason: 'all must checks pass' }), title)!;
    expect(done.family).toBe('goalFinished');
    expect(done.text).toContain('✅');
    expect(done.text).toContain('Add dark mode');
    expect(done.path).toBe('/goals/g1');
    expect(compose(ev('goal.state_changed', { from: 'goal_review', to: 'over_delivered', reason: 'stretch too' }), title)!.text).toContain('🏆');
    const failed = compose(ev('goal.state_changed', { from: 'running', to: 'failed', reason: 'human: abort' }), title)!;
    expect(failed.text).toContain('human: abort');
  });

  test('cancelled and non-terminal transitions stay silent', () => {
    expect(compose(ev('goal.state_changed', { from: 'running', to: 'cancelled', reason: 'human' }), title)).toBeNull();
    expect(compose(ev('goal.state_changed', { from: 'blocked', to: 'running', reason: 'escalation answered' }), title)).toBeNull();
  });

  test('delivery events carry the PR facts', () => {
    const opened = compose(ev('delivery.pr_opened', { number: 7, url: 'https://github.com/x/y/pull/7', base: 'main', head: 'goal', taskId: null, title: 'feat: dark mode' }), title)!;
    expect(opened.family).toBe('delivery');
    expect(opened.text).toContain('#7');
    expect(opened.text).toContain('https://github.com/x/y/pull/7');
    const failed = compose(ev('delivery.failed', { step: 'push', reason: 'remote rejected' }), title)!;
    expect(failed.text).toContain('push');
    expect(failed.text).toContain('remote rejected');
  });

  test('rate-limit pause and resume notify', () => {
    expect(compose(ev('rate_limit.paused', { rateLimitType: 'five_hour', until: '2026-08-28T05:00:00Z', reason: 'limit' }, null), title)!.family).toBe('rateLimit');
    expect(compose(ev('rate_limit.resumed', { reason: 'window reset' }, null), title)!.text).toContain('resume');
  });

  test('quota notifications use the event backend and do not promise a reset', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const paused = compose(ev('rate_limit.paused', { provider, until: '2026-10-05T00:00:00Z', reason: 'limit', rateLimitType: null }, null), title, provider === 'codex' ? 'claude' : 'codex')!;
      expect(paused.path).toBe(`/usage?provider=${provider}`);
      expect(paused.text).toContain(provider === 'codex' ? 'Codex' : 'Claude Code');
      expect(paused.text).toContain('retry at');
      const resumed = compose(ev('rate_limit.resumed', { provider, reason: 'retry time reached' }, null), title)!;
      expect(resumed.path).toBe(paused.path);
      expect(resumed.text).toContain('retries resume');
      expect(resumed.text).not.toContain('lifted');
    }
    expect(compose(ev('rate_limit.resumed', { reason: 'legacy' }, null), title, 'codex')!.path).toBe('/usage?provider=codex');
  });

  test('unrelated events stay silent', () => {
    expect(compose(ev('engine.note', { level: 'warn', message: 'notification via telegram failed' }, null), title)).toBeNull();
    expect(compose(ev('task.state_changed', { taskId: 't1', from: 'running', to: 'blocked', reason: 'escalation retries_exhausted' }), title)).toBeNull();
  });
});

describe('deploys', () => {
  test('a finished deploy names its host and address, a failed one why; both under the Delivery switch', () => {
    const live = compose(ev('deploy.finished', { provider: 'vercel', production: false, url: 'https://site-abc.vercel.app' }), title)!;
    expect(live).toEqual({ family: 'delivery', text: '🚀 Deployed to Vercel (preview) — Add dark mode\nhttps://site-abc.vercel.app', path: '/goals/g1#delivery' });
    expect(compose(ev('deploy.finished', { provider: 'netlify', production: true, url: 'https://site.netlify.app' }), title)!.text).toStartWith('🚀 Deployed to Netlify — ');
    const failed = compose(ev('deploy.failed', { provider: 'cloudflare', production: false, reason: 'the build failed' }), title)!;
    expect(failed.text).toBe('⚠️ Deploy to Cloudflare Pages failed — Add dark mode\nthe build failed');
  });
});

describe('composeEscalation', () => {
  test('says which goal needs the human and why, and points at the inbox', () => {
    const esc = { id: 'esc1', goalId: 'g1', taskId: 't1', attemptId: null, trigger: 'retries_exhausted', message: 'Task "x" used 3/3 attempts', payload: {}, state: 'open', answer: null, createdAt: '', answeredAt: null, suggestion: null } as Escalation;
    const c = composeEscalation(esc, title);
    expect(c.text).toContain('Needs you');
    expect(c.text).toContain('Add dark mode');
    expect(c.text).toContain('out of attempts');
    expect(c.path).toBe('/inbox');
  });
});

describe('milestones', () => {
  test('a milestone that does not pause and its recording both reach the channels', () => {
    const passed = compose(ev('goal.milestone_passed', { taskId: 't1', lookFor: 'press Show' }), () => 'Demo');
    expect(passed).toMatchObject({ family: 'milestone', path: '/goals/g1' });
    expect(passed!.text).toContain('press Show');
    const evidence = compose(ev('milestone.evidence', { taskId: 't1', video: 'v.webm', shots: [], summary: 'presses Show', error: null }), () => 'Demo');
    expect(evidence!.text).toBe('📸 What the milestone looks like — Demo\npresses Show');
    const partly = compose(ev('milestone.evidence', { taskId: 't1', video: null, shots: [], summary: 'opens /dev', error: '3 screenshot(s) showed HTTP 404 at /dev and were left out' }), () => 'Demo');
    expect(partly!.text).toBe('📸 What the milestone looks like — Demo\nopens /dev\n⚠️ 3 screenshot(s) showed HTTP 404 at /dev and were left out');
  });

  test("a milestone of files speaks of what the task produced, never of a walkthrough", () => {
    const shown = compose(ev('milestone.evidence', { taskId: 't1', video: null, shots: [{ file: 's.png', caption: 'bracket_iso.png' }], summary: '', error: null, status: 'pass', kind: 'files', files: ['bracket.step', 'bracket.stl'] }), () => 'Demo');
    expect(shown!.text).toBe('📸 What the task produced — Demo\nFiles: bracket.step, bracket.stl');
    const many = compose(ev('milestone.evidence', { taskId: 't1', video: null, shots: [], summary: 'Nothing to preview.', error: null, status: 'pass', kind: 'files', files: ['a.step', 'b.step', 'c.step', 'd.step', 'e.step', 'f.step', 'g.pdf'] }), () => 'Demo');
    expect(many!.text).toBe('📸 What the task produced — Demo\nNothing to preview.\nFiles: a.step, b.step, c.step, d.step, e.step, f.step and 1 more');
    const nothing = compose(ev('milestone.evidence', { taskId: 't1', video: null, shots: [], summary: '', error: 'the task left no snapshots or exports under artifacts/: there is nothing to look at', status: 'fail', kind: 'files' }), () => 'Demo');
    expect(nothing!.text).toBe('⚠️ Nothing to look at yet — Demo\nThe task left no snapshots or exports under artifacts/: there is nothing to look at');
  });
});

describe('composeBriefReady', () => {
  const goal = (over: Partial<Goal> = {}) => ({ id: 'g1', title: 'Add dark mode', provider: 'claude', budgetPreset: 'auto', budgets: { maxCostUsd: null, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 }, delegatedFrom: null, delegation: { allow: false, autoApprove: false }, ...over }) as unknown as Goal;
  const brief = (over: Partial<Brief> = {}) => ({ understanding: 'A dark theme for every screen.', questions: [], tasks: [{}, {}], costEstimateUsd: 2.5, timeEstimateMin: 45, ...over }) as unknown as Brief;

  test('says what the plan is, what it should cost and the budget approval sets, and links to the Brief', () => {
    const c = composeBriefReady(goal(), brief(), 'clarify done')!;
    expect(c.family).toBe('briefReady');
    expect(c.text.split('\n')).toEqual(['📋 Brief ready — Add dark mode', '2 tasks · estimate $2.50 · ~45 min', 'Budget on approval: $5 / 90 min (the estimate ×2).', 'A dark theme for every screen.']);
    expect(c.path).toBe('/goals/g1/brief');
    expect(composeBriefReady(goal({ provider: 'codex' }), brief(), 'x')!.text).toContain('2 tasks · estimate ~45 min');
  });

  test('a blocking question is named instead of a budget', () => {
    expect(composeBriefReady(goal(), brief({ questions: [{ text: 'Which?', blocking: true, answer: null }] } as Partial<Brief>), 'x')!.text).toContain('1 blocking question to answer on the Brief first.');
  });

  test('nobody is told about a Brief the engine approves itself', () => {
    expect(composeBriefReady(goal(), brief(), 'auto brief')).toBeNull();
    expect(composeBriefReady(goal(), null, 'x')).toBeNull();
    const delegated = goal({ delegatedFrom: { goalId: 'g0', taskId: 't0', title: 'the site', style: null, at: '' }, delegation: { allow: false, autoApprove: true } } as Partial<Goal>);
    expect(composeBriefReady(delegated, brief(), 'clarify done')).toBeNull();
    // unless a blocking question is left for the person: then the main goal waits for them
    expect(composeBriefReady(delegated, brief({ questions: [{ text: 'Which?', blocking: true, answer: '' }] } as Partial<Brief>), 'clarify done')).not.toBeNull();
  });
});
