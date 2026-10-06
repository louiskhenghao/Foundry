import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diff, git } from '../git/git.ts';
import { diffSections, fitDiff, renderDiffSection, sectionCounts, sectionPath } from './reviewer.ts';

/** A new file's diff section: `lines` added lines. */
const section = (path: string, lines: number) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${Array.from({ length: lines }, (_, i) => `+line ${i} of ${path}`).join('\n')}\n`;

describe('fitDiff', () => {
  test('a diff that fits is pasted as it is, with no file list', () => {
    const d = section('a.ts', 3) + section('b.ts', 3);
    const fit = fitDiff(d, d.length);
    expect(fit).toEqual({ text: d, files: null });
    expect(renderDiffSection(fit, d.length, null)).toBe(`# Diff\n\`\`\`diff\n${d}\n\`\`\``);
  });

  test('whole files go in while they fit, a smaller later file still gets in, and the first file left out is cut at a line boundary', () => {
    const a = section('a.ts', 5);
    const big = section('big.mjs', 400);
    const c = section('c.md', 5);
    const fit = fitDiff(a + big + c, 3000);
    expect(fit.files!.map((f) => [f.path, f.shown])).toEqual([
      ['a.ts', 'whole'],
      ['big.mjs', 'part'],
      ['c.md', 'whole'],
    ]);
    expect(fit.text.length).toBeLessThanOrEqual(3000);
    expect(fit.text.startsWith(a)).toBe(true);
    expect(fit.text.endsWith(c)).toBe(true);
    const part = fit.text.slice(a.length, fit.text.length - c.length);
    expect(part).toEndWith('[… cut here: the rest of this file is in the saved diff]\n');
    const kept = part.slice(0, part.indexOf('[… cut here'));
    expect(big.startsWith(kept)).toBe(true);
    expect(kept).toEndWith('\n'); // never mid-line: `await puppete` reads as a syntax error
  });

  test('with too little room left, the next file is not started and is listed as not shown', () => {
    const a = section('a.ts', 5);
    const big = section('big.mjs', 400);
    const fit = fitDiff(a + big, a.length + 200);
    expect(fit.text).toBe(a);
    expect(fit.files!.map((f) => f.shown)).toEqual(['whole', 'none']);
  });

  test('a single file larger than the budget still has its head pasted', () => {
    const big = section('big.mjs', 400);
    const fit = fitDiff(big, 1500);
    expect(fit.files!.map((f) => f.shown)).toEqual(['part']);
    expect(fit.text.length).toBeLessThanOrEqual(1500);
    expect(fit.text.startsWith('diff --git a/big.mjs b/big.mjs\n')).toBe(true);
  });
});

describe('diff sections', () => {
  test('paths: spaces, moves and quoted names', () => {
    expect(sectionPath('diff --git a/a b.txt b/a b.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a b.txt\t\n')).toBe('a b.txt');
    expect(sectionPath('diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n')).toBe('new.ts');
    expect(sectionPath('diff --git "a/x\\ty" "b/x\\ty"\n')).toBe('x\\ty');
  });

  test('counts: only hunk lines count, and binary files have none', () => {
    const s = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+++ starts with plus signs\n context\n';
    expect(sectionCounts(s)).toEqual({ insertions: 1, deletions: 1 });
    expect(sectionCounts('diff --git a/p.png b/p.png\nindex 1..2 100644\nBinary files a/p.png and b/p.png differ\n')).toEqual({ insertions: null, deletions: null });
    expect(sectionCounts('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n')).toEqual({ insertions: 0, deletions: 0 });
  });

  test('the Diff section of a partial diff lists every file and where to read the rest', () => {
    const d = section('a.ts', 5) + section('big.mjs', 400) + section('知识库/决策日志.md', 3);
    const fit = fitDiff(d, 3000);
    const out = renderDiffSection(fit, d.length, '/x/.foundry/g/review/task-diff-a_1.patch');
    expect(out).toStartWith('# Diff (partial)\n');
    expect(out).toContain(`This task's diff is ${d.length.toLocaleString('en-US')} characters`);
    expect(out).toContain('- `a.ts` (+5): whole');
    expect(out).toContain('- `big.mjs` (+400): first part only, cut at a line boundary');
    expect(out).toContain('- `知识库/决策日志.md` (+3): whole');
    expect(out).toContain('saved at `/x/.foundry/g/review/task-diff-a_1.patch`');
    expect(out).toContain('NOT incomplete and NOT missing');
    expect(renderDiffSection(fit, d.length, null)).toContain('open the file itself');
  });

  test('a diff over many files lists the ones not pasted whole', () => {
    const d = Array.from({ length: 150 }, (_, i) => section(`f${String(i).padStart(3, '0')}.ts`, 1)).join('');
    const fit = fitDiff(d, Math.floor(d.length / 2));
    const out = renderDiffSection(fit, d.length, null);
    const notWhole = fit.files!.filter((f) => f.shown !== 'whole');
    expect(notWhole.length).toBeGreaterThan(0);
    expect(out).not.toContain('- `f000.ts`');
    expect(out).toContain(`- \`${notWhole.at(-1)!.path}\``);
    expect(out).toContain(`- … ${150 - notWhole.length} more files`);
  });
});

describe('diff on a real repository', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test('non-ASCII paths print as they are, and a `-diff` file is one binary line', async () => {
    const d = mkdtempSync(join(tmpdir(), 'foundry-review-'));
    dirs.push(d);
    const g = (args: string[]) => git(['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args], d);
    await g(['init', '-q', '-b', 'main']);
    await g(['commit', '-q', '--allow-empty', '-m', 'base']);
    mkdirSync(join(d, '知识库', '_gen'), { recursive: true });
    writeFileSync(join(d, '知识库', '决策 日志.md'), '### D-365\n');
    writeFileSync(join(d, '知识库', '_gen', 'index.md'), 'generated\n'.repeat(50));
    writeFileSync(join(d, '.gitattributes'), '知识库/_gen/** -diff\n');
    await g(['add', '-A']);
    await g(['commit', '-q', '-m', 'change']);
    const out = await diff(d, 'HEAD~1', 'HEAD', Number.POSITIVE_INFINITY);
    const files = diffSections(out).map((s) => [sectionPath(s), sectionCounts(s)]);
    expect(files).toEqual([
      ['.gitattributes', { insertions: 1, deletions: 0 }],
      ['知识库/_gen/index.md', { insertions: null, deletions: null }],
      ['知识库/决策 日志.md', { insertions: 1, deletions: 0 }],
    ]);
  });
});
