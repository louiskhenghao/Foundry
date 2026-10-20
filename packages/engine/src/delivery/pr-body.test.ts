import { describe, expect, test } from 'bun:test';
import type { Brief, CheckResult, Goal, Task } from '@foundry/core';
import { buildPrBody, buildTaskPrBody } from './policy.ts';

const goal = { id: 'g_1', title: 'CSV export', prompt: 'Export orders as CSV.', costUsd: 1.5, baseBranch: 'main', branch: 'goal/g_1' } as Goal;
const brief = {
  understanding: 'A Download CSV button exports the orders on screen.',
  areas: [{ key: 'A1', name: 'Orders page', slug: 'orders', description: '' }],
  questions: [{ id: 'q1', text: 'Which delimiter?', answer: 'comma', blocking: false, areaKey: null, options: [], kind: 'text', applied: true }],
  assumptions: [],
  tasks: [],
  checks: [],
  styleOptions: [],
} as unknown as Brief;
const tasks = [
  { id: 't1', title: 'add the export endpoint', area: 'A1', commitMessage: 'feat(orders): add the export endpoint\n\nbody' },
  { id: 't2', title: 'add the export button', area: 'A1', commitMessage: null },
  { id: 't3', title: 'tidy the helpers', area: null, commitMessage: null },
] as Task[];
const res = (checkId: string, status: string) => ({ checkId, status, summary: '' }) as CheckResult;

describe('the pull request body', () => {
  test('Summary (what and where), Decisions, Evidence (the checks) and Merge Danger (door and blast radius), in that order', () => {
    const body = buildPrBody(goal, brief, { mustResults: [res('c1', 'pass')], stretchResults: [res('c2', 'fail')], notes: 'Solid.', overDelivered: false }, new Map([['c1', 'tests pass'], ['c2', 'a11y']]), { tasks, stats: { commits: 2, files: 4, insertions: 120, deletions: 8 } });
    const at = (s: string) => body.indexOf(s);
    expect(at('## Summary')).toBe(0);
    expect(at('## Summary') < at('## Decisions') && at('## Decisions') < at('## Evidence') && at('## Evidence') < at('## Merge Danger')).toBe(true);
    expect(body).toContain('A Download CSV button exports the orders on screen.');
    // the tasks as a tree under their Areas, by their commit headers; a task without an Area sits at the root
    expect(body).toContain('```text\nCSV export\n  Orders page\n    feat(orders): add the export endpoint\n    add the export button\n  tidy the helpers\n```');
    expect(body).toContain('- **Which delimiter?** — comma');
    expect(body).toContain('| tests pass | ✅ pass |');
    expect(body).toContain('| a11y | ❌ fail |');
    expect(body).toContain('Solid.');
    expect(body).toContain('**Door:** two-way');
    expect(body).toContain('2 commits');
    expect(body).toContain('**Blast Radius:** small');
    expect(body).toContain('4 files, +120 −8');
    expect(body).toContain('_Opened by Foundry · goal `g_1`');
  });

  test('the blast radius grows with the diff; without a review or stats the sections still read', () => {
    const big = buildPrBody(goal, null, null, new Map(), { tasks: [], stats: { commits: 9, files: 40, insertions: 1500, deletions: 300 } });
    expect(big).toContain('**Blast Radius:** large');
    expect(big).not.toContain('## Decisions');
    expect(big).toContain('## Evidence\n\nNo checks were run.');
    const medium = buildPrBody(goal, null, null, new Map(), { tasks: [], stats: { commits: 1, files: 3, insertions: 400, deletions: 100 } });
    expect(medium).toContain('**Blast Radius:** medium');
    const bare = buildPrBody(goal, null, null, new Map());
    expect(bare).toContain('**Blast Radius:** unknown');
  });

  test('a stacked task PR carries its own evidence and merge danger', () => {
    const body = buildTaskPrBody(goal, { ...tasks[0]!, spec: 'Add GET /orders.csv' } as Task, { index: 1, total: 2, goalTitle: 'feat(orders): export', prevPr: null, prevBranch: null }, [{ name: 'tests pass', status: 'pass' }], 'fine', { files: 2, insertions: 30, deletions: 1 });
    const at = (s: string) => body.indexOf(s);
    expect(at('## Summary') < at('## Evidence') && at('## Evidence') < at('## Merge Danger')).toBe(true);
    expect(body).toContain('Add GET /orders.csv');
    expect(body).toContain('| tests pass | ✅ pass |');
    expect(body).toContain('fine');
    expect(body).toContain('**Door:** two-way');
    expect(body).toContain('**Blast Radius:** small');
    expect(body).toContain('2 files, +30 −1');
  });
});
