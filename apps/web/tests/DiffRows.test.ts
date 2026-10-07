import { describe, expect, test } from 'bun:test';
import { rowsOf } from '../src/pages/goal/DiffTab.tsx';

describe('diff rows', () => {
  test('numbers each line in the old and the new file and keeps the hunk headers', () => {
    const rows = rowsOf(['index 1..2 100644', '--- a/x.ts', '+++ b/x.ts', '@@ -3,3 +3,4 @@ fn', ' keep', '-old', '+new', '+more', ' tail', '\\ No newline at end of file']);
    expect(rows.map((r) => [r.kind, r.old, r.new, r.text])).toEqual([
      ['hunk', null, null, '@@ -3,3 +3,4 @@ fn'],
      ['ctx', 3, 3, 'keep'],
      ['del', 4, null, 'old'],
      ['add', null, 4, 'new'],
      ['add', null, 5, 'more'],
      ['ctx', 5, 6, 'tail'],
    ]);
  });
});
