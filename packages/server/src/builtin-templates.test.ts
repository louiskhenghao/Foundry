import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TEMPLATE_ID, TemplateNature, inputRequired, placeholdersOf } from '@foundry/core';
import { listTemplates } from './templates.ts';

const DIR = resolve(import.meta.dir, '../../../templates');

/**
 * The templates Foundry ships (ADR-0079): every one in English and 中文, the two one template — same inputs, same
 * settings, same nature — and no file that cannot be read.
 */
describe('the built-in templates', () => {
  const empty = mkdtempSync(join(tmpdir(), 'foundry-no-own-templates-'));
  const listed = listTemplates(DIR, empty);
  rmSync(empty, { recursive: true, force: true });

  test('every file reads, and every template has both languages', () => {
    expect(listed.problems).toEqual([]);
    expect(readdirSync(DIR).filter((f) => !f.endsWith('.md'))).toEqual([]);
    expect(listed.templates.length).toBeGreaterThanOrEqual(14);
    for (const t of listed.templates) {
      expect(t.builtIn).toBe(true);
      expect(TEMPLATE_ID.test(t.id), t.id).toBe(true);
      expect(t.en, `${t.id} in English`).not.toBeNull();
      expect(t.zh, `${t.id} in 中文`).not.toBeNull();
      expect(t.zh!.name, `${t.id} 中文 name`).toMatch(/[一-鿿]/);
      expect(t.en!.warnings, `${t.id}.md`).toEqual([]);
      expect(t.zh!.warnings, `${t.id}.zh.md`).toEqual([]);
      expect(t.en!.summary.length, `${t.id} summary`).toBeGreaterThan(20);
    }
  });

  test('the two languages are one template: the same inputs (each language words its body in its own order), kinds and settings', () => {
    const shape = (v: { inputs: { key: string; type: string; options?: string[]; required?: boolean; default?: string }[] }) => v.inputs.map((i) => [i.key, i.type, inputRequired(i), i.options?.length ?? 0]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const t of listed.templates) {
      const [en, zh] = [t.en!, t.zh!];
      expect(zh.nature, t.id).toBe(en.nature);
      expect(zh.settings, t.id).toEqual(en.settings);
      expect(placeholdersOf(zh.body).sort(), `${t.id} placeholders`).toEqual(placeholdersOf(en.body).sort());
      expect(shape(zh), `${t.id} inputs`).toEqual(shape(en));
    }
  });

  test('every nature has at least two templates; the engine and style settings sit only where they belong', () => {
    for (const nature of TemplateNature.options) expect(listed.templates.filter((t) => t.nature === nature).length, nature).toBeGreaterThanOrEqual(nature === 'research' ? 1 : 2);
    for (const t of listed.templates) {
      if (t.settings.videoPack) expect(t.nature, `${t.id} has a video engine`).toBe('video');
      if (t.settings.figurePack) expect(t.nature, `${t.id} has a figure style`).toBe('figure');
      // a choice input offers its default among its options, so the form can show it chosen
      for (const i of [...t.en!.inputs, ...t.zh!.inputs]) if (i.type === 'choice' && i.default !== undefined) expect(i.options, `${t.id} ${i.key}`).toContain(i.default);
      // read filled in, every blank has something to show: an example, or the default
      for (const i of [...t.en!.inputs, ...t.zh!.inputs]) expect(i.example ?? i.default, `${t.id} ${i.key} has no example`).toBeTruthy();
    }
  });

  test('no built-in template chooses the Quick budget: its $3 counts Clarify, which alone can cost that much (live run 2026-10-25)', () => {
    for (const t of listed.templates) expect(t.settings.budgetPreset, t.id).not.toBe('quick');
  });
});

