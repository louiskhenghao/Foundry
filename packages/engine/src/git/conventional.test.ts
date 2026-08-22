import { describe, expect, test } from 'bun:test';
import { branchSlug, ccHeader, goalHeader, isConventional, parseHeader, taskCommitMessage, typeForKind } from './conventional.ts';

describe('conventional commits', () => {
  test('type from task kind', () => {
    expect(typeForKind('feature')).toBe('feat');
    expect(typeForKind('bug')).toBe('fix');
    expect(typeForKind('refactor')).toBe('refactor');
    expect(typeForKind('research')).toBe('docs');
    expect(typeForKind('chore')).toBe('chore');
  });

  test('header: prefix, scope cleaning, trailing period, no double prefix', () => {
    expect(ccHeader({ type: 'feat', subject: 'Add quote engine.' })).toBe('feat: Add quote engine');
    expect(ccHeader({ type: 'feat', scope: 'Quotes API', subject: 'add engine' })).toBe('feat(quotes-api): add engine');
    expect(ccHeader({ type: 'feat', scope: 'ui', subject: 'fix(auth): handle expired token' })).toBe('fix(auth): handle expired token');
    expect(ccHeader({ type: 'feat', scope: 'ui', subject: 'wip: something' })).toBe('feat(ui): something');
    expect(ccHeader({ type: 'fix', subject: 'feat!: drop legacy api' })).toBe('feat!: drop legacy api');
    expect(ccHeader({ type: 'chore', subject: '   ' })).toBe('chore: update');
  });

  test('header is capped at 72 chars on a word boundary', () => {
    const long = 'implement the content data module and the quotation engine with unit tests for every pdf number';
    const h = ccHeader({ type: 'feat', scope: 'quotes', subject: long });
    expect(h.length).toBeLessThanOrEqual(72);
    expect(h.endsWith('…')).toBe(true);
    expect(h.startsWith('feat(quotes): implement the content data module')).toBe(true);
  });

  test('isConventional / parseHeader', () => {
    expect(isConventional('feat(site): add landing page')).toBe(true);
    expect(isConventional('docs: explain stacks')).toBe(true);
    expect(isConventional('Add landing page')).toBe(false);
    expect(isConventional('feat:')).toBe(false);
    expect(parseHeader('fix(api)!: reject empty body')).toEqual({ type: 'fix', scope: 'api', breaking: true, subject: 'reject empty body' });
  });

  test('task commit message carries task/goal trailers and the attempt marker', () => {
    const task = { id: 't_1', title: 'add quote engine', kind: 'feature' as const, scope: 'quotes' };
    const final = taskCommitMessage({ id: 'g_1' }, task);
    expect(final.split('\n')[0]).toBe('feat(quotes): add quote engine');
    expect(final).toContain('Task: t_1');
    expect(final).toContain('Goal: g_1');
    expect(final).not.toContain('Attempt:');
    expect(taskCommitMessage({ id: 'g_1' }, task, { attempt: 2 })).toContain('Attempt: 2');
  });

  test('goal header: brief title wins, otherwise dominant type + goal title', () => {
    expect(goalHeader({ title: 'whatever' }, 'feat(site): add resort page', [])).toBe('feat(site): add resort page');
    expect(goalHeader({ title: 'Fix the broken checkout flow' }, '', [{ kind: 'bug' }, { kind: 'bug' }, { kind: 'chore' }])).toBe('fix: Fix the broken checkout flow');
    expect(goalHeader({ title: 'x' }, 'not a header', [{ kind: 'feature' }])).toBe('feat: not a header');
  });

  test('branch slug', () => {
    expect(branchSlug('feat(quotes): Add the Quote Engine!')).toBe('add-the-quote-engine');
    expect(branchSlug('内容数据模块')).toBe('part');
    expect(branchSlug('a'.repeat(50)).length).toBe(30);
  });
});
