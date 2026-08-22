/**
 * (Re)create fixtures/demo-repo — a tiny bun project with a planted failing test.
 *   bun scripts/make-fixture.ts [--sabotage] [--parallel]
 *     --sabotage  make the test impossible to pass (for escalation testing)
 *     --parallel  add a second module so two tasks can run in parallel and conflict on a shared file
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sabotage = process.argv.includes('--sabotage');
const parallel = process.argv.includes('--parallel');
const dir = resolve(import.meta.dir, '../fixtures/demo-repo');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'src'), { recursive: true });

writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-repo', private: true, type: 'module', scripts: { test: 'bun test', typecheck: 'bunx tsc --noEmit -p .' } }, null, 2));
writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', types: ['bun-types'], noEmit: true }, include: ['src'] }, null, 2));
writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
writeFileSync(join(dir, 'README.md'), '# demo-repo\n\nTiny fixture for ai-engine. `bun test` must pass.\n');
writeFileSync(
  join(dir, 'src/math.ts'),
  `export function add(a: number, b: number): number {
  return a - b; // BUG: should add
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
);
writeFileSync(
  join(dir, 'src/math.test.ts'),
  `import { expect, test } from 'bun:test';
import { add, multiply } from './math.ts';

test('add', () => {
  expect(add(2, 3)).toBe(5);
  ${sabotage ? 'expect(add(2, 3)).toBe(6); // impossible: contradicts the line above' : ''}
});

test('multiply', () => {
  expect(multiply(2, 3)).toBe(6);
});
`,
);
if (parallel) {
  writeFileSync(join(dir, 'src/index.ts'), `export { add, multiply } from './math.ts';\n`);
  writeFileSync(join(dir, 'src/strings.ts'), `export function shout(s: string): string {\n  return s.toUpperCase();\n}\n`);
  writeFileSync(join(dir, 'src/strings.test.ts'), `import { expect, test } from 'bun:test';\nimport { shout } from './strings.ts';\n\ntest('shout', () => {\n  expect(shout('a')).toBe('A');\n});\n`);
}

await Bun.$`git -C ${dir} init -q -b main`;
await Bun.$`git -C ${dir} -c user.name=fixture -c user.email=fixture@local add -A`;
await Bun.$`git -C ${dir} -c user.name=fixture -c user.email=fixture@local commit -q -m "initial fixture"`;
const withRemote = process.argv.includes('--remote');
if (withRemote) {
  const remote = resolve(import.meta.dir, '../fixtures/demo-remote.git');
  rmSync(remote, { recursive: true, force: true });
  await Bun.$`git init -q --bare ${remote}`;
  await Bun.$`git -C ${dir} remote add origin ${remote}`;
  await Bun.$`git -C ${dir} push -q -u origin main`;
}
console.log(`fixture ready at ${dir}${sabotage ? ' (sabotaged)' : ''}${parallel ? ' (parallel)' : ''}${withRemote ? ' (with bare remote)' : ''}`);
