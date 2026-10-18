import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BriefSubject } from '@foundry/core/browser';
import { LikenessChip, LikenessView, likenessOf, type Likeness } from '../src/pages/goal/MilestoneEvidence.tsx';
import { SubjectsCard } from '../src/pages/brief/SubjectsCard.tsx';

const subject: BriefSubject = { key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the nose and the wing', pictures: [{ file: 'P1-1.jpg', source: 'web', url: 'https://www.example.com/press', caption: 'front three-quarter' }], search: { status: 'ok', detail: '', at: 'x' } };
const look: Likeness = {
  taskId: 't1',
  evidenceAt: '2026-10-18T05:00:00Z',
  status: 'ok',
  verdict: { subjects: [{ key: 'P1', shown: true, score: 4, matches: ['the colour'], differences: [{ what: 'the wheels are small', major: false }, { what: 'the nose is rounded, not a flat wedge', major: true }], shots: ['a.png'] }], summary: 'a sports car, not this one' },
  detail: '',
  costUsd: 0.3,
  fixTaskId: 't_fix',
};

test('a likeness review shows each Subject with its score, its pictures, the major differences first and the fix it added', () => {
  const html = renderToStaticMarkup(<LikenessView goalId="g" look={look} subjects={[subject]} running={false} fixTitle="match Porsche 911 GT3 (992) to its pictures" />);
  expect(html).toContain('Likeness to the pictures</span> · a sports car, not this one');
  expect(html).toContain('>4/10<');
  expect(html).toContain('src="/api/goals/g/subjects/P1-1.jpg"');
  expect(html.indexOf('the nose is rounded')).toBeLessThan(html.indexOf('the wheels are small'));
  expect(html).toContain('Matches: the colour');
  expect(html).toContain('Foundry added “match Porsche 911 GT3 (992) to its pictures”');
  expect(renderToStaticMarkup(<LikenessChip look={look} />)).toContain('likeness 4/10');
});

test('a review on its way, one with no verdict, and none at all', () => {
  expect(renderToStaticMarkup(<LikenessView goalId="g" look={null} subjects={[subject]} running fixTitle={null} />)).toContain('Comparing with the pictures');
  expect(renderToStaticMarkup(<LikenessView goalId="g" look={{ ...look, status: 'failed', verdict: null, detail: 'no verdict (error_max_turns)' }} subjects={[subject]} running={false} fixTitle={null} />)).toContain('gave no verdict: no verdict (error_max_turns)');
  expect(renderToStaticMarkup(<LikenessView goalId="g" look={null} subjects={[subject]} running={false} fixTitle={null} />)).toBe('');
  expect(renderToStaticMarkup(<LikenessChip look={null} />)).toBe('');
});

test("a recording's review is the one made for that recording", () => {
  const d = { milestoneEvents: [{ type: 'milestone.likeness', ts: 'x', payload: { ...look, evidenceAt: 'earlier' } }, { type: 'milestone.likeness', ts: 'y', payload: look }] } as never;
  expect(likenessOf(d, 't1', look.evidenceAt)).toEqual(look);
  expect(likenessOf(d, 't1', 'later')).toBeNull();
});

test('the Subjects card shows the pictures with where they came from, a search on its way, and what to do when none was found', () => {
  const none: BriefSubject = { key: 'P2', name: 'Nürburgring Nordschleife', lookFor: '', pictures: [], search: { status: 'ok', detail: 'nothing usable', at: 'x' } };
  const html = renderToStaticMarkup(<SubjectsCard goalId="g" subjects={[subject, none]} searching={[]} editable />);
  expect(html).toContain('Porsche 911 GT3 (992)');
  expect(html).toContain('front three-quarter · example.com');
  expect(html).toContain('No picture found (nothing usable): search again, or add your own.');
  expect(html).toContain('Add and find pictures');
  expect(renderToStaticMarkup(<SubjectsCard goalId="g" subjects={[none]} searching={['P2']} editable={false} />)).toContain('Finding pictures…');
});
