import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReviewRound } from '@foundry/core/browser';
import { ReviewRounds, roundLine } from '../src/pages/goal/ReviewRounds.tsx';

const round = (over: Partial<ReviewRound> = {}): ReviewRound => ({
  id: 'rev_1',
  prNumber: 3,
  at: '2026-10-20T10:05:00Z',
  comments: [
    { id: 1, kind: 'inline', author: 'pat', body: 'rename', path: 'src/x.ts', line: 4, diffHunk: null, url: 'https://github.com/acme/app/pull/3#discussion_r1', createdAt: null },
    { id: 2, kind: 'inline', author: 'sam', body: 'test', path: 'src/x.ts', line: 9, diffHunk: null, url: null, createdAt: null },
  ],
  status: 'pending',
  requested: false,
  commit: null,
  replied: 0,
  detail: null,
  finishedAt: null,
  ...over,
});
const html = (rounds: ReviewRound[], open = true) => renderToStaticMarkup(<ReviewRounds rounds={rounds} open={open} busy={false} onFix={() => {}} />);

test('each round says what came in and what Foundry did with it', () => {
  expect(roundLine(round())).toBe('2 comments · waiting for you');
  expect(roundLine(round({ requested: true }))).toBe('2 comments · asked for, starting');
  expect(roundLine(round({ status: 'fixing' }))).toBe('2 comments · a fix task addresses them');
  expect(roundLine(round({ status: 'addressed', commit: 'abcdef1234', replied: 2 }))).toBe('2 comments · addressed in abcdef1, replied under each');
  expect(roundLine(round({ status: 'addressed', commit: 'abcdef1234', replied: 1 }))).toBe('2 comments · addressed in abcdef1, replied under 1 of 2');
  expect(roundLine(round({ status: 'nochange', replied: 2 }))).toBe('2 comments · looked at, nothing to change, replied');
  expect(roundLine(round({ status: 'failed' }))).toBe('2 comments · could not be addressed');
});

test('a waiting round on an open PR offers Fix review comments; an addressed one, or a closed PR, does not', () => {
  const waiting = html([round()]);
  expect(waiting).toContain('Fix review comments');
  expect(waiting).toContain('@pat, @sam');
  expect(waiting).toContain('https://github.com/acme/app/pull/3#discussion_r1');
  expect(html([round({ status: 'addressed', commit: 'abc1234', replied: 2 })])).not.toContain('Fix review comments');
  expect(html([round({ requested: true })])).not.toContain('Fix review comments');
  expect(html([round()], false)).not.toContain('Fix review comments');
  expect(html([])).toBe('');
});
