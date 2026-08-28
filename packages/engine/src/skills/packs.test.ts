import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignPack, ImagePack, VideoPack } from '@foundry/core';
import { DESIGN_PACK_OPTIONS, IMAGE_PACK_OPTIONS, VIDEO_PACK_OPTIONS } from './packs.ts';
import { Catalog } from './types.ts';

const CASES = [
  { pack: 'design', schema: DesignPack, options: DESIGN_PACK_OPTIONS },
  { pack: 'image', schema: ImagePack, options: IMAGE_PACK_OPTIONS },
  { pack: 'video', schema: VideoPack, options: VIDEO_PACK_OPTIONS },
] as const;

describe('pack options', () => {
  test('every settings enum value has a PackOption and vice versa', () => {
    for (const c of CASES) {
      expect(c.options.map((o) => o.id).sort()).toEqual([...c.schema.options].sort());
    }
  });

  test('every non-none option has at least one catalog entry, and every pack entry maps to a known option', () => {
    const catalog = Catalog.parse(JSON.parse(readFileSync(join(import.meta.dir, '../../../..', 'catalog', 'skills.json'), 'utf8')));
    for (const c of CASES) {
      const entryOptions = new Set(catalog.entries.filter((e) => e.pack === c.pack).map((e) => e.packOption));
      for (const o of c.options) {
        if (o.id === 'none') continue;
        expect(entryOptions.has(o.id)).toBe(true);
      }
      for (const opt of entryOptions) expect(c.options.some((o) => o.id === opt)).toBe(true);
    }
  });
});
