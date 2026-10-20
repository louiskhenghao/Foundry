/**
 * The role-prompt regression set (ADR-0062): a few small, fixed goals a maintainer runs against the real coding agent
 * when a workflow suite is bumped (mattpocock, pstack), a model alias moves, or a role's prompt changes, and compares
 * with the last run: what passed, what it cost, how long it took. Each case starts from a fixture built here (no files
 * in the repository), says what the finished checkout must satisfy, and which files the goal may touch.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type FixtureName = 'bun-lib' | 'static-page';

export interface RegressCase {
  /** short, stable: the key results are compared by */
  name: string;
  title: string;
  fixture: FixtureName;
  prompt: string;
  nature?: 'code' | 'docs';
  /** shell commands that must exit 0 in the finished goal's checkout */
  checks: string[];
  /** globs of the files the goal may change; a change outside them fails the case */
  allowed: string[];
  maxCostUsd: number;
  maxMinutes: number;
}

export const CASES: RegressCase[] = [
  {
    name: 'fix-failing-test',
    title: 'Fix the planted bug so the tests pass, touching nothing else',
    fixture: 'bun-lib',
    prompt: '`bun test` fails on add: the function subtracts instead of adding. Fix add so the tests pass. Change nothing else.',
    checks: ['bun test'],
    allowed: ['src/math.ts'],
    maxCostUsd: 1.5,
    maxMinutes: 15,
  },
  {
    name: 'add-feature-with-tests',
    title: 'Two new functions with tests, exported from the index',
    fixture: 'bun-lib',
    prompt: 'Add subtract(a, b) and divide(a, b) to src/math.ts (divide throws on b === 0), export both from src/index.ts beside add and multiply, and cover them in src/math.test.ts. The existing add test fails because add subtracts: fix add as well.',
    checks: ['bun test', "grep -q 'subtract' src/index.ts", "grep -q 'divide' src/index.ts", "grep -q 'subtract' src/math.test.ts"],
    allowed: ['src/**', 'README.md'],
    maxCostUsd: 3,
    maxMinutes: 25,
  },
  {
    name: 'docs-only',
    title: 'A Usage section in the README, no code change',
    fixture: 'bun-lib',
    nature: 'docs',
    prompt: 'Write a "## Usage" section in README.md that shows how to import and call add and multiply from src/math.ts, with one short example each. Do not change the code or the tests.',
    checks: ["grep -q '^## Usage' README.md", "grep -q 'multiply' README.md"],
    allowed: ['README.md'],
    maxCostUsd: 1.5,
    maxMinutes: 15,
  },
  {
    name: 'refactor-keeps-behaviour',
    title: 'A refactor that keeps every test green',
    fixture: 'bun-lib',
    prompt: 'Document add and multiply in src/math.ts with JSDoc comments (parameters and return) and rename their parameters to left and right. Behaviour must not change and the tests must pass as they are; add still has a bug (it subtracts), fix that too.',
    checks: ['bun test', "grep -q '@param' src/math.ts", "grep -q 'left' src/math.ts"],
    allowed: ['src/math.ts'],
    maxCostUsd: 1.5,
    maxMinutes: 15,
  },
  {
    name: 'static-page-feature',
    title: 'A small feature on a static page',
    fixture: 'static-page',
    prompt: 'Add a "Copy link" button under the heading of index.html that copies the page URL to the clipboard and reads "Copied" for two seconds. Plain HTML, CSS and JavaScript in the existing files; no build step, no dependency.',
    checks: ["grep -qi 'copy link' index.html", "grep -qi 'clipboard' app.js || grep -qi 'clipboard' index.html"],
    allowed: ['index.html', 'app.js', 'style.css'],
    maxCostUsd: 2,
    maxMinutes: 20,
  },
];

/** The case named, or every case; a name that is not one is an error. */
export function pickCases(names: string[] | null): RegressCase[] {
  if (!names?.length) return CASES;
  return names.map((n) => {
    const c = CASES.find((x) => x.name === n);
    if (!c) throw new Error(`no regression case named ${n}; the cases are ${CASES.map((x) => x.name).join(', ')}`);
    return c;
  });
}

const FILES: Record<FixtureName, Record<string, string>> = {
  'bun-lib': {
    'package.json': JSON.stringify({ name: 'demo-lib', private: true, type: 'module', scripts: { test: 'bun test' } }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', types: ['bun-types'], noEmit: true }, include: ['src'] }, null, 2) + '\n',
    '.gitignore': 'node_modules\n',
    'README.md': '# demo-lib\n\nA tiny library. `bun test` runs its tests.\n',
    'src/math.ts': 'export function add(a: number, b: number): number {\n  return a - b; // BUG: should add\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n',
    'src/index.ts': "export { add, multiply } from './math.ts';\n",
    'src/math.test.ts': "import { expect, test } from 'bun:test';\nimport { add, multiply } from './math.ts';\n\ntest('add', () => {\n  expect(add(2, 3)).toBe(5);\n});\n\ntest('multiply', () => {\n  expect(multiply(2, 3)).toBe(6);\n});\n",
  },
  'static-page': {
    'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>Studio</title>\n  <link rel="stylesheet" href="style.css" />\n</head>\n<body>\n  <main>\n    <h1>A small studio</h1>\n    <p>We make small games with big hearts.</p>\n  </main>\n  <script src="app.js"></script>\n</body>\n</html>\n',
    'style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }\nmain { max-width: 40rem; margin: 0 auto; }\n',
    'app.js': "document.querySelector('h1')?.addEventListener('click', () => console.log('hello'));\n",
    'README.md': '# studio page\n\nA static page: open index.html in a browser. No build step.\n',
  },
};

/** Build a fixture as a fresh git repository at `dir`; returns its first commit, the point the goal's changes are read from. */
export async function makeFixture(name: FixtureName, dir: string): Promise<string> {
  for (const [path, text] of Object.entries(FILES[name])) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (args: string) => Bun.$`sh -c ${`git -c user.name=fixture -c user.email=fixture@local ${args}`}`.cwd(dir).quiet();
  await git('init -q -b main');
  await git('add -A');
  await git('commit -q -m "initial fixture"');
  return (await Bun.$`git rev-parse HEAD`.cwd(dir).text()).trim();
}
