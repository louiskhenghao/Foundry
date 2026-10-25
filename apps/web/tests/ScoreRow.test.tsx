import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoreRow } from '../src/components/ScoreRow.tsx';

test("a reviewer's scores: one chip per scored axis, in the rubric's order, the bar's colour", () => {
  const html = renderToStaticMarkup(<ScoreRow scores={{ hook: 9, motion: 7, sound: 4 }} />);
  expect(html.indexOf('hook')).toBeLessThan(html.indexOf('motion'));
  expect(html.indexOf('motion')).toBeLessThan(html.indexOf('sound'));
  expect(html).not.toContain('readability');
  expect(html).toMatch(/text-ok-ink[^>]*>9</);
  expect(html).toMatch(/text-you-ink[^>]*>7</);
  expect(html).toMatch(/text-bad-ink[^>]*>4</);
});

test('the move since the attempt before, when there was one', () => {
  const html = renderToStaticMarkup(<ScoreRow scores={{ hook: 9, motion: 6 }} prev={{ hook: 7, motion: 8 }} />);
  expect(html).toContain('↑2');
  expect(html).toContain('↓2');
  expect(renderToStaticMarkup(<ScoreRow scores={{ hook: 9 }} prev={{ hook: 9 }} />)).not.toMatch(/[↑↓]/);
});

test('nothing scored: nothing shown', () => {
  expect(renderToStaticMarkup(<ScoreRow scores={{}} />)).toBe('');
});
