import { expect, test } from 'bun:test';
import { describe as describeEvent } from '../src/pages/goal/describe.ts';

const ev = (type: string, payload: unknown) => ({ id: 'e', ts: '2026-10-20T00:00:00Z', goalId: 'g', type, payload }) as any;

test('the interview, a Revise and the Brief skeleton read as sentences in Activity, not as event names', () => {
  expect(describeEvent(ev('interview.round_asked', { round: 2, sessionId: 's', questions: [{}, {}] })).text).toBe('Clarifier asked round 2: 2 questions');
  expect(describeEvent(ev('interview.round_asked', { round: 1, sessionId: 's', questions: [{}] })).text).toBe('Clarifier asked round 1: 1 question');
  expect(describeEvent(ev('interview.round_answered', { round: 2, answers: { a: '1' }, finish: false, note: 'x' })).text).toBe('You answered round 2: 1 answer, with a note');
  expect(describeEvent(ev('interview.round_answered', { round: 1, answers: {}, finish: true, note: null })).text).toBe('You asked for the Brief after round 1: no answers');
  expect(describeEvent(ev('interview.finished', { rounds: 2, reason: 'brief' })).text).toBe('Interview over after 2 rounds: nothing left to ask');
  expect(describeEvent(ev('interview.finished', { rounds: 0, reason: 'nothing_to_ask' })).text).toBe('Interview over: nothing to ask');
  expect(describeEvent(ev('interview.finished', { rounds: 3, reason: 'human' })).text).toBe('Interview over after 3 rounds: you asked for the Brief');
  expect(describeEvent(ev('revise.round_asked', { round: 1, sessionId: null, questions: [{}] })).text).toBe('Revise asked round 1: 1 question');
  expect(describeEvent(ev('revise.round_answered', { round: 1, answers: { a: '1', b: '2' }, finish: false, note: null })).text).toBe('You answered the Revise round 1: 2 answers');
  expect(describeEvent(ev('revise.finished', { rounds: 1, reason: 'proposal' })).text).toBe('Revise proposed after 1 round');
  expect(describeEvent(ev('revise.finished', { rounds: 1, reason: 'abandoned' })).text).toBe('Revise let go after 1 round');
  expect(describeEvent(ev('brief.skeleton_proposed', { brief: { areas: [1, 2, 3] } })).text).toBe('Brief skeleton proposed: 3 Areas; the planner is splitting the goal into tasks');
  expect(describeEvent(ev('clarify.stage', { stage: 'queued' })).text).toBe('Waiting for a free session slot');
  expect(describeEvent(ev('clarify.stage', { stage: 'investigating' })).text).toBe('REA studying the references');
  expect(describeEvent(ev('goal.nature_set', { nature: 'docs', reason: 'clarifier verdict' })).text).toBe('Nature: docs (clarifier verdict)');
  expect(describeEvent(ev('goal.reclarified', { reason: 'fetch again', workspaceRebuilt: true, decisions: '' })).text).toBe('Clarify re-run: fetch again');
  expect(describeEvent(ev('brief.edited', { brief: {} })).text).toBe('Brief edited');
  expect(describeEvent(ev('brief.decision_added', { id: 'q', text: 'keep it', answer: 'keep it' })).text).toBe('Note added: keep it');
});
