import { describe, expect, test } from 'bun:test';
import type { Brief, Goal, Learning, Task } from '@foundry/core';
import { briefRevisionDocument, learningsDocument, reviewDocument, transcriptDocument } from './record.ts';

const goal = { id: 'g1', title: 'Add dark mode', state: 'done' } as Goal;
const task = { id: 't1', title: 'Add the toggle', relevantFiles: ['src/settings.tsx'] } as Task;
const brief = (over: Partial<Brief> = {}): Brief => ({ title: 'feat: dark mode', understanding: 'A toggle on the settings page.', areas: [], assumptions: [], questions: [], checks: [], tasks: [], ...over }) as unknown as Brief;
const learning = (over: Partial<Learning>): Learning => ({ id: 'l1', kind: 'build', text: 'Run bun install first.', by: 'foundry', goalId: 'g0', goalTitle: 'An earlier goal', at: '2026-10-01T00:00:00Z', ...over });

describe('the documents Foundry writes into a bank', () => {
  test('a Brief revision names what changed, and is nothing when nothing did', () => {
    expect(briefRevisionDocument(goal, brief(), brief(), 1)).toBeNull();
    const doc = briefRevisionDocument(goal, brief(), brief({ understanding: 'A toggle that remembers its state.', tasks: [{ key: 'T1', title: 'Persist the theme', spec: 'Write it to settings.json' } as Brief['tasks'][number]], assumptions: [{ text: 'No server-side state.', accepted: true } as Brief['assumptions'][number]] }), 3)!;
    expect(doc.documentId).toBe('goal:g1:brief:3');
    expect(doc.content).toContain('revision 3');
    expect(doc.content).toContain('understanding before:\nA toggle on the settings page.');
    expect(doc.content).toContain('understanding after:\nA toggle that remembers its state.');
    expect(doc.content).toContain('- task added: Persist the theme\n  Write it to settings.json');
    expect(doc.content).toContain('- assumption added: No server-side state.');
    expect(doc.tags).toEqual(['source:foundry', 'goal:g1', 'stage:brief']);
  });

  test("the Learnings notebook replaces the one before it and marks the person's entries", () => {
    const doc = learningsDocument([learning({}), learning({ id: 'l2', kind: 'preference', text: 'Comments in English.', by: 'human', goalId: null, goalTitle: null })]);
    expect(doc.documentId).toBe('learnings:notebook');
    expect(doc.updateMode).toBe('replace');
    expect(doc.content).toContain('2 curated entries');
    expect(doc.content).toContain('- [build] Run bun install first. (learned by the goal "An earlier goal")');
    expect(doc.content).toContain('- [preference] Comments in English. (the person wrote this)');
  });

  test('a review verdict keeps the blockers, the notes and the files', () => {
    const doc = reviewDocument(goal, task, { id: 'a1', index: 2 }, { pass: false, blockers: ['No test covers the toggle.'], notes: 'Otherwise fine.' });
    expect(doc.documentId).toBe('goal:g1:review:a1');
    expect(doc.content).toBe('Review of attempt 2 of the task "Add the toggle" (goal "Add dark mode"): refused.\nBlockers:\n- No test covers the toggle.\nNotes: Otherwise fine.\nFiles the task was about: src/settings.tsx');
    expect(doc.tags).toEqual(['source:foundry', 'goal:g1', 'stage:review', 'task:t1', 'verdict:fail']);
    expect(reviewDocument(goal, task, { id: 'a2', index: 3 }, { pass: true, blockers: [] }).tags).toContain('verdict:pass');
  });

  test('a transcript carries how the attempt ended, in its context and its tags', () => {
    const doc = transcriptDocument(goal, task, { id: 'a1', index: 1 }, { state: 'failed', reason: '2 failing' }, '{"role":"assistant","content":"hi"}');
    expect(doc.documentId).toBe('goal:g1:attempt:a1');
    expect(doc.context).toContain('attempt 1 for the task "Add the toggle"');
    expect(doc.context).toContain('ended failed (2 failing)');
    expect(doc.tags).toEqual(['source:transcript', 'goal:g1', 'task:t1', 'attempt:a1', 'outcome:failed']);
    expect(transcriptDocument(goal, null, { id: 'a1', index: 1 }, { state: 'passed', reason: '' }, 'x').tags).not.toContain('task:t1');
  });
});
