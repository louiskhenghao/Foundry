import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { help } from '../../../../apps/cli/src/help.ts';
import { SETTING_PATHS } from '../settings.ts';
import { SETTING_DOCS, renderCliReference, renderConfigurationReference } from './settings-reference.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('generated reference docs', () => {
  test('every setting in the schema is documented, and nothing documented is gone from the schema', () => {
    expect(SETTING_PATHS.filter((p) => !SETTING_DOCS[p])).toEqual([]);
    expect(Object.keys(SETTING_DOCS).filter((p) => !SETTING_PATHS.includes(p))).toEqual([]);
  });
  test('docs/operate/configuration.md and cli.md are up to date (run `bun scripts/gen-docs.ts`)', () => {
    expect(read('docs/operate/configuration.md')).toBe(renderConfigurationReference());
    expect(read('docs/operate/cli.md')).toBe(renderCliReference(help));
  });
  test('every Settings section label used by the reference exists in the web UI', () => {
    const page = read('apps/web/src/pages/SettingsPage.tsx');
    for (const section of new Set(Object.values(SETTING_DOCS).map((d) => d.section))) expect(page).toContain(`label: '${section}'`);
  });
});
