import { describe, expect, test } from 'bun:test';
import type { EngineEvent, Escalation } from '@foundry/core';
import { compose, composeEscalation } from './dispatcher.ts';

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

  test('unrelated events stay silent', () => {
    expect(compose(ev('engine.note', { level: 'warn', message: 'notification via telegram failed' }, null), title)).toBeNull();
    expect(compose(ev('task.state_changed', { taskId: 't1', from: 'running', to: 'blocked', reason: 'escalation retries_exhausted' }), title)).toBeNull();
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
