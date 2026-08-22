import { expect, test } from 'bun:test';
import { truncateOutput } from './truncate.ts';

test('short output passes through', () => {
  expect(truncateOutput('ok\n')).toBe('ok');
});

test('long output keeps head, tail and error lines within budget', () => {
  const lines: string[] = [];
  for (let i = 0; i < 2000; i++) lines.push(i === 1000 ? 'Error: something exploded at line 1000' : `line ${i} ${'x'.repeat(20)}`);
  const out = truncateOutput(lines.join('\n'), { maxBytes: 3000 });
  expect(out.length).toBeLessThanOrEqual(3000);
  expect(out).toContain('line 0 ');
  expect(out).toContain('something exploded');
  expect(out).toContain('line 1999');
});
