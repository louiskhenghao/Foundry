import { expect, test } from 'bun:test';
import { buildAttemptPrompt } from './attempt-prompt.ts';

const base = {
  goal: { title: 'G', prompt: 'do it' } as any,
  task: { title: 'T', spec: 'spec', relevantFiles: [] } as any,
  checks: [],
  attemptIndex: 1,
  maxAttempts: 3,
  prevReport: null,
  rolledBack: null,
  hint: null,
  relevantContext: null,
};

test('skills hint appears once, before How to work; absent when null', () => {
  const p = buildAttemptPrompt({ ...base, skillsHint: 'Installed skills relevant to this role (use when appropriate): /tdd' });
  expect(p.split('# Skills').length).toBe(2);
  expect(p.indexOf('# Skills')).toBeLessThan(p.indexOf('# How to work'));
  expect(buildAttemptPrompt({ ...base, skillsHint: null })).not.toContain('# Skills');
});

test('attachments section sits after Start here / before checks and is absent when empty', () => {
  const att = '# Attachments from the user\n- [image] mock.png → /data/attachments/g/att/mock.png. Open it with the Read tool.';
  const p = buildAttemptPrompt({ ...base, task: { title: 'T', spec: 'spec', relevantFiles: ['src/a.ts'] } as any, attachments: att, checks: [{ id: 'c', tier: 'must', name: 'tests', spec: { type: 'command', cmd: 'bun test', expectExitCode: 0, timeoutMs: 1000 } } as any] });
  expect(p.indexOf('# Start here')).toBeLessThan(p.indexOf('# Attachments from the user'));
  expect(p.indexOf('# Attachments from the user')).toBeLessThan(p.indexOf('# Acceptance checks'));
  expect(buildAttemptPrompt({ ...base, attachments: '' })).not.toContain('# Attachments');
});

test('a full workflow section is inserted verbatim (its own heading), a bare hint gets the # Skills heading', () => {
  const section = '# Workflow skills\n- MUST: invoke `/tdd` — tests first';
  const p = buildAttemptPrompt({ ...base, skillsHint: section });
  expect(p.split('# Workflow skills').length).toBe(2);
  expect(p).not.toContain('# Skills');
  expect(p.indexOf('# Workflow skills')).toBeLessThan(p.indexOf('# How to work'));
});

test('the Area line sits under the task heading when the task has one', () => {
  const withArea = buildAttemptPrompt({ ...base, task: { ...base.task, area: 'Teacher portal' }, areaDescription: 'what teachers see' });
  expect(withArea).toContain('# Your task (T)\nArea: Teacher portal — what teachers see\nAttempt 1 of 3.');
  expect(buildAttemptPrompt(base)).not.toContain('Area:');
});

test('the Decisions section follows the task spec and precedes Start here', () => {
  const p = buildAttemptPrompt({ ...base, task: { ...base.task, relevantFiles: ['a.ts'] }, decisions: '# Decisions from the human\n- Q: DB?\n  A: sqlite' });
  expect(p.indexOf('# Decisions from the human')).toBeGreaterThan(p.indexOf('# Your task'));
  expect(p.indexOf('# Decisions from the human')).toBeLessThan(p.indexOf('# Start here'));
  expect(buildAttemptPrompt(base)).not.toContain('Decisions');
});
