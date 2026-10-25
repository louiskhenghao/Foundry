import { describe, expect, test } from 'bun:test';
import type { TemplateEntry, TemplateVersionView } from '@foundry/core/browser';
import { byNature, complete, formPatch, initialValues, matchesSearch, missingLabels, offeredTemplates, shownVersion } from '../src/pages/new-goal-template.ts';

const version = (over: Partial<TemplateVersionView> = {}): TemplateVersionView => ({ lang: 'en', name: 'Product reel', summary: 'A short film.', nature: 'video', settings: {}, inputs: [{ key: 'product', type: 'text', other: false }, { key: 'duration', type: 'choice', other: false, options: ['30 s', '60 s'], default: '30 s' }, { key: 'brand', type: 'textarea', other: false, required: false }], body: 'A {{duration}} reel for {{product}}. {{brand}}', file: null, warnings: [], ...over });
const entry = (over: Partial<TemplateEntry> = {}): TemplateEntry => ({ id: 'video-product-reel', builtIn: true, nature: 'video', settings: { videoPack: 'motion-studio', mode: 'simple', budgetPreset: 'thorough' }, en: version(), zh: version({ lang: 'zh', name: '产品 reel' }), ...over });

describe('templates on the New goal form', () => {
  test('shows the language chosen, else the one the template has', () => {
    expect(shownVersion(entry(), 'zh').name).toBe('产品 reel');
    expect(shownVersion(entry({ zh: null }), 'zh').name).toBe('Product reel');
    expect(shownVersion(entry({ en: null }), 'en').name).toBe('产品 reel');
  });

  test('hides the figure and motion-studio templates while their Beta is off, and groups by kind', () => {
    const all = [entry(), entry({ id: 'figure-kettle', nature: 'figure', settings: {} }), entry({ id: 'code-feature', nature: 'code', settings: {} }), entry({ id: 'video-plain', nature: 'video', settings: {} })];
    expect(offeredTemplates(all, { figure: false, motionStudio: false }).map((t) => t.id)).toEqual(['code-feature', 'video-plain']);
    expect(offeredTemplates(all, { figure: true, motionStudio: true }).map((t) => t.id)).toEqual(['video-product-reel', 'figure-kettle', 'code-feature', 'video-plain']);
    expect(byNature(all).map((g) => [g.nature, g.templates.length])).toEqual([['code', 1], ['video', 2], ['figure', 1]]);
  });

  test('a search reads the name, the summary, the body and the input labels in the shown language', () => {
    expect(matchesSearch(entry(), 'en', 'REEL')).toBe(true);
    expect(matchesSearch(entry(), 'en', 'short film')).toBe(true);
    expect(matchesSearch(entry(), 'en', 'Brand')).toBe(true);
    expect(matchesSearch(entry(), 'en', '产品')).toBe(false);
    expect(matchesSearch(entry(), 'zh', '产品')).toBe(true);
    expect(matchesSearch(entry(), 'en', '  ')).toBe(true);
  });

  test('inputs start from their defaults; what is missing is said by label; complete means every required one answered', () => {
    const v = version();
    expect(initialValues(v)).toEqual({ product: '', duration: '30 s', brand: '' });
    expect(missingLabels(v, initialValues(v))).toEqual(['Product']);
    expect(complete(v, initialValues(v))).toBe(false);
    expect(complete(v, { ...initialValues(v), product: 'Foundry' })).toBe(true);
  });

  test('the form patch carries only what the template says, and drops a Beta engine or style while the Beta is off', () => {
    const on = formPatch(entry(), { figure: true, motionStudio: true });
    expect(on).toEqual({ nature: 'video', videoPack: 'motion-studio', mode: 'simple', budget: { preset: 'thorough', budgets: { maxCostUsd: 25, maxDurationMin: 480, maxConcurrent: 3, attemptsPerTask: 4, attemptTimeoutMin: null } }, dropped: [] });
    const off = formPatch(entry(), { figure: false, motionStudio: false });
    expect(off.videoPack).toBeUndefined();
    expect(off.dropped).toEqual(['its video engine (motion-studio): the motion-studio Beta is off']);
    const custom = formPatch(entry({ nature: 'code', settings: { budgetPreset: 'custom', budgets: { maxCostUsd: 9 }, workflow: { pace: 'fast', tdd: 'off' }, interviewDepth: 0, autoBrief: { mustChecks: ['bun test'], stretchChecks: ['bun run lint'] } } }), { figure: false, motionStudio: false });
    expect(custom).toEqual({ nature: 'code', pace: 'fast', tdd: 'off', budget: { preset: 'custom', budgets: { maxCostUsd: 9, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: null } }, interviewDepth: '0', auto: { checks: 'bun test', stretch: 'bun run lint' }, dropped: [] });
    expect(formPatch(entry({ nature: 'figure', settings: { figurePack: 'iso-glow' } }), { figure: true, motionStudio: false }).figurePack).toBe('iso-glow');
  });
});
