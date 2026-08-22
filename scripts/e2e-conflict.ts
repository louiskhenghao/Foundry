/**
 * M3 e2e: two parallel tasks that both edit src/math.ts and src/index.ts at the same spots,
 * forcing a merge conflict that a Merge Attempt must resolve, then a fan-in verification task.
 *
 *   bun scripts/make-fixture.ts --parallel && bun scripts/e2e-conflict.ts [--model sonnet]
 */
import { resolve } from 'node:path';

const BASE = process.env.AI_ENGINE_URL ?? `http://127.0.0.1:${process.env.AI_ENGINE_PORT ?? 4111}`;
const model = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : undefined;
const repoPath = resolve(import.meta.dir, '../fixtures/demo-repo');

const cmd = (key: string, name: string, tier: 'must' | 'stretch', taskKey: string | null, c: string) => ({ key, name, tier, taskKey, spec: { type: 'command', cmd: c, timeoutMs: 120_000, expectExitCode: 0 } });

const body = {
  title: 'Conflict e2e: subtract + divide in parallel',
  prompt: 'Add subtract and divide to the math module (in parallel), export both from src/index.ts, then verify the merged result.',
  repoPath,
  budgets: { maxCostUsd: 4, maxConcurrent: 3, attemptsPerTask: 2 },
  models: model ? { worker: model, strong: model } : undefined,
  brief: {
    understanding: 'Deterministic conflict scenario for the merge path.',
    assumptions: [],
    tasks: [
      {
        key: 'T1',
        title: 'Add subtract to math and export it',
        spec: 'In src/math.ts add `export function subtract(a: number, b: number): number` directly AFTER the `add` function (before `multiply`). In src/index.ts change the single export line to also export `subtract` (keep it as ONE export line: `export { add, subtract, multiply } from \'./math.ts\';`). Add a test for subtract in src/math.test.ts right after the add test. Also fix the add bug (`a - b` → `a + b`) so tests pass. Do not touch anything else.',
        dependsOnKeys: [],
        parallelizable: true,
        relevantFiles: ['src/math.ts', 'src/index.ts', 'src/math.test.ts'],
      },
      {
        key: 'T2',
        title: 'Add divide to math and export it',
        spec: 'In src/math.ts add `export function divide(a: number, b: number): number` (throw on b === 0) directly AFTER the `add` function (before `multiply`). In src/index.ts change the single export line to also export `divide` (keep it as ONE export line: `export { add, divide, multiply } from \'./math.ts\';`). Add a test for divide in src/math.test.ts right after the add test. Also fix the add bug (`a - b` → `a + b`) so tests pass. Do not touch anything else.',
        dependsOnKeys: [],
        parallelizable: true,
        relevantFiles: ['src/math.ts', 'src/index.ts', 'src/math.test.ts'],
      },
      {
        key: 'T3',
        title: 'Verify merged exports',
        spec: 'Confirm src/index.ts exports add, subtract, divide and multiply (one export line), and that `bun test` passes. Add a test file src/index.test.ts that imports all four from ./index.ts and asserts they are functions. Do not change other files unless a test fails because of a bad merge.',
        dependsOnKeys: ['T1', 'T2'],
        parallelizable: false,
        relevantFiles: ['src/index.ts'],
      },
    ],
    checks: [
      cmd('C1', 'tests pass', 'must', 'T1', 'bun test'),
      cmd('C2', 'tests pass', 'must', 'T2', 'bun test'),
      cmd('C3', 'tests pass', 'must', 'T3', 'bun test'),
      cmd('C4', 'index exports all four', 'must', 'T3', "grep -E 'export \\{[^}]*subtract[^}]*\\}' src/index.ts && grep -E 'export \\{[^}]*divide[^}]*\\}' src/index.ts"),
      cmd('G1', 'goal: tests pass', 'must', null, 'bun test'),
      cmd('G2', 'goal: index exports all four', 'must', null, "grep -E 'export \\{[^}]*subtract[^}]*\\}' src/index.ts && grep -E 'export \\{[^}]*divide[^}]*\\}' src/index.ts"),
      cmd('S1', 'stretch: README mentions divide', 'stretch', null, 'grep -q divide README.md'),
    ],
    costEstimateUsd: 1.5,
    timeEstimateMin: 10,
    questions: [],
  },
};

const res = await fetch(`${BASE}/api/goals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const goal = await res.json();
if (!res.ok) {
  console.error(goal);
  process.exit(1);
}
console.log(`created ${goal.id} [${goal.state}] → ${BASE}/goals/${goal.id}`);
console.log(`watch:  bun apps/cli/src/main.ts watch ${goal.id}`);
