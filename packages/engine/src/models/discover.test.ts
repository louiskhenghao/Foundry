import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelsInBinary } from './discover.ts';

describe('modelsInBinary', () => {
  test('finds family ids in the bytes, drops provider variants and compound ids, marks the newest per family', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-discover-'));
    const bin = join(dir, 'claude');
    const noise = '\u0000\u0001';
    writeFileSync(bin, ['claude-opus-4-1-20250805', 'claude-opus-4-1-20250805-v1', 'claude-opus-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-mythos-5', 'claude-sonnet-5', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'claude-haiku-3-55'].join(noise));
    const found = modelsInBinary(bin);
    const ids = found.map((f) => f.id);
    expect(ids).not.toContain('claude-opus-4-1-20250805-v1');
    expect(ids).not.toContain('claude-fable-5-mythos-5');
    expect(ids).not.toContain('claude-haiku-3-55');
    expect(found.filter((f) => f.newest).map((f) => f.id).sort()).toEqual(['claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5']);
    rmSync(dir, { recursive: true, force: true });
  });
  test('the installed Claude Code knows at least one newest id per main family', () => {
    const bin = Bun.which('claude');
    if (!bin) return;
    const newest: string[] = modelsInBinary(bin).filter((f) => f.newest).map((f) => f.family);
    for (const fam of ['opus', 'sonnet', 'haiku']) expect(newest).toContain(fam);
  });
});
