import { describe, expect, test } from 'bun:test';
import type { Goal, Task } from '@foundry/core';
import { buildAttemptPrompt } from '../attempt-prompt.ts';
import { MEMORY_HEADING, memoryQuestion, memorySection } from './prompt.ts';

describe('what a session is told from Memory', () => {
  test('the section carries the answer, and the bank only for a session that has the tools', () => {
    const plain = memorySection('Tests run with `bun test`; the toggle broke twice on reload.', { tools: false });
    expect(plain.startsWith(`${MEMORY_HEADING}\n`)).toBe(true);
    expect(plain).toContain('the code wins');
    expect(plain).toContain('the toggle broke twice on reload.');
    expect(plain).not.toContain('bank_id');
    const worker = memorySection('x', { tools: true, bankId: 'coding-agent::app' });
    expect(worker).toContain('Memory bank: `coding-agent::app`');
    expect(worker).toContain('pass this bank_id');
    expect(worker).toContain('search_knowledge_base');
    const person = memorySection('They refuse new dependencies without a reason.', { tools: false, about: 'person' });
    expect(person.startsWith(`${MEMORY_HEADING} about the person\n`)).toBe(true);
    expect(person).toContain('They refuse new dependencies without a reason.');
    expect(person).not.toContain('the code wins');
    expect(memoryQuestion('person', { goalTitle: 'Add dark mode', goalPrompt: 'Please add a dark mode.' })).toContain('"Add dark mode": Please add a dark mode.');
  });

  test('each stage asks in its own words, naming the goal, the task and its files', () => {
    const q = memoryQuestion('attempt', { goalTitle: 'Add dark mode', taskTitle: 'Add the toggle', taskSpec: 'A toggle on the settings page.', area: 'settings', files: ['src/settings.tsx'] });
    expect(q).toContain('"Add the toggle" (area: settings)');
    expect(q).toContain('It touches src/settings.tsx.');
    expect(q).toContain('A toggle on the settings page.');
    expect(memoryQuestion('clarify', { goalTitle: 'Add dark mode', goalPrompt: 'Please add a dark mode.' })).toContain('Please add a dark mode.');
    expect(memoryQuestion('replan', { goalTitle: 'Add dark mode', taskTitle: 'Data model' })).toContain('after "Data model" landed');
    expect(memoryQuestion('review_task', { goalTitle: 'Add dark mode', taskTitle: 'Add the toggle' })).toContain('What earlier reviews here refused');
    expect(memoryQuestion('review_goal', { goalTitle: 'Add dark mode' })).toContain('"Add dark mode" in this repository as a whole');
  });

  test("an attempt's prompt carries the section after the repository notes", () => {
    const goal = { id: 'g1', title: 'Add dark mode', prompt: 'Add a dark mode.', branch: 'goal/g1', references: [], attachments: [] } as unknown as Goal;
    const task = { id: 't1', title: 'Add the toggle', spec: 'A toggle.', area: null, relevantFiles: [], delivers: [], scenario: 'frontend', kind: 'feature', milestone: null } as unknown as Task;
    const memory = memorySection('The toggle broke twice on reload.', { tools: false });
    const prompt = buildAttemptPrompt({ goal, task, checks: [], attemptIndex: 1, maxAttempts: 2, prevReport: null, rolledBack: null, hint: null, relevantContext: null, learnings: '# Notes on this repository\n- Run bun install first.', memory });
    expect(prompt.indexOf('# Notes on this repository')).toBeLessThan(prompt.indexOf(MEMORY_HEADING));
    expect(prompt.indexOf(MEMORY_HEADING)).toBeLessThan(prompt.indexOf('# How to work'));
    expect(buildAttemptPrompt({ goal, task, checks: [], attemptIndex: 1, maxAttempts: 2, prevReport: null, rolledBack: null, hint: null, relevantContext: null })).not.toContain(MEMORY_HEADING);
  });
});
