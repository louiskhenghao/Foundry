import { describe, expect, test } from 'bun:test';
import { cleanDeliverables, deliversCheckName, deliversCheckSpec, validDeliverable } from './delivers.ts';

describe('Deliverables', () => {
  test('a Deliverable is one path inside the repository: relative, no parent steps, no globs, no shell', () => {
    for (const ok of ['docs/research/roadster.md', 'artifacts/roadster.glb', 'src/data/specs.ts', 'public/models', "it's here.md"]) expect(validDeliverable(ok)).toBe(true);
    for (const bad of ['', '/etc/passwd', '~/x', 'C:\\x', '../up.md', 'a/../../b', 'src/*.ts', 'x$(rm -rf /)', 'a\nb']) expect(validDeliverable(bad)).toBe(false);
  });

  test('the planner’s list is trimmed, `./` dropped, repeats and bad ones left out', () => {
    expect(cleanDeliverables([' ./docs/a.md ', 'docs/a.md', 'artifacts/out/', '../x', '', 'b.txt'])).toEqual(['docs/a.md', 'artifacts/out', 'b.txt']);
    expect(cleanDeliverables(undefined)).toEqual([]);
  });

  test('the must check is an existence test that survives a quote in the name', () => {
    expect(deliversCheckSpec('docs/a.md')).toEqual({ type: 'command', cmd: "test -e 'docs/a.md'", timeoutMs: 60_000, expectExitCode: 0 });
    expect(deliversCheckSpec("it's.md").cmd).toBe("test -e 'it'\\''s.md'");
    expect(deliversCheckName('docs/a.md')).toBe('Delivers docs/a.md');
  });
});
