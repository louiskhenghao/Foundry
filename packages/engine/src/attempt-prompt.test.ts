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

test('a UI milestone task is told the walkthrough must run, with a dev:mock script when the real app cannot', () => {
  const ui = buildAttemptPrompt({ ...base, task: { title: 'T', spec: 'spec', relevantFiles: [], milestone: 'open /dev and see the kit', scenario: 'frontend' } as any });
  expect(ui).toContain('# This task is a milestone');
  expect(ui).toContain('open /dev and see the kit');
  expect(ui).toContain('dev:mock');
  expect(buildAttemptPrompt({ ...base, task: { title: 'T', spec: 'spec', relevantFiles: [], milestone: 'x', scenario: 'backend' } as any })).not.toContain('# This task is a milestone');
  expect(buildAttemptPrompt(base)).not.toContain('# This task is a milestone');
});

test('a feature milestone task, whatever its scenario, is told to write its Playwright script and make it pass', () => {
  const p = buildAttemptPrompt({ ...base, task: { title: 'T', spec: 'spec', relevantFiles: [], milestone: 'call the users API', milestoneScript: 'e2e/milestones/users-api.spec.ts', scenario: 'backend' } as any });
  expect(p).toContain('# This task is a milestone: write its script');
  expect(p).toContain('`e2e/milestones/users-api.spec.ts`');
  expect(p).toContain('process.env.API_PORT');
  expect(p).toContain("test.info().attach(");
  expect(p).not.toContain('dev:mock');
});

test('a goal with a reference tells the worker where the report is and the rules', () => {
  const goal = { ...base.goal, references: [{ target: 'https://notes.example.com', lookAt: 'how search ranks results' }], investigation: { status: 'ok', summary: 'recency first', attachmentId: 'att_1', docPath: 'docs/reference/notes-example-com.md', costUsd: 1, detail: '', at: 'x' }, attachments: [{ id: 'att_1', kind: 'file', name: 'reference-notes-example-com.md', mime: 'text/markdown', size: 1, path: 'p', url: null, note: null, addedAt: 'x', markdown: null }] } as any;
  const p = buildAttemptPrompt({ ...base, goal });
  expect(p).toContain('# Reference');
  expect(p).toContain('https://notes.example.com — look at: how search ranks results');
  expect(p).toContain('attached as reference-notes-example-com.md and committed as docs/reference/notes-example-com.md');
  expect(p).toContain('never copy proprietary code');
  expect(buildAttemptPrompt(base)).not.toContain('# Reference');
});

test('a cad task gets the CAD conventions (source in the repository, exports and snapshots in artifacts/) and no style direction', () => {
  const { styleApplies } = require('./attempt-prompt.ts') as typeof import('./attempt-prompt.ts');
  const p = buildAttemptPrompt({ ...base, task: { title: 'T', spec: 'a bracket', relevantFiles: [], scenario: 'cad' } as any });
  expect(p).toContain('# CAD conventions');
  expect(p).toContain('snapshots');
  // the cad skill's own example layout would commit exports beside the source: the convention says which wins
  expect(p).toContain("overrides the cad skill's example layout");
  expect(p).toContain('commit no STEP, STL, 3MF, GLB or snapshot file');
  // a committed check that imports a skill's tool from the plugin folder breaks with the next plugin update
  expect(p).toContain("Nothing you commit may reach into the coding agent's plugin folder");
  expect(p).not.toContain('# Media conventions');
  expect(p.indexOf('# CAD conventions')).toBeLessThan(p.indexOf('# How to work'));
  expect(styleApplies('cad')).toBe(false);
  expect(styleApplies('image')).toBe(true);
});
