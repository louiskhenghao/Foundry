import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mmxSignedIn } from './mmx.ts';

describe('mmxSignedIn', () => {
  test('a key or an OAuth login in the mmx config counts; no file or a broken one does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-mmx-'));
    expect(mmxSignedIn(dir)).toBe(false);
    writeFileSync(join(dir, 'config.json'), '{ not json');
    expect(mmxSignedIn(dir)).toBe(false);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ region: 'global' }));
    expect(mmxSignedIn(dir)).toBe(false);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ api_key: 'sk-cp-1' }));
    expect(mmxSignedIn(dir)).toBe(true);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ oauth: { access_token: 't' } }));
    expect(mmxSignedIn(dir)).toBe(true);
  });
});
