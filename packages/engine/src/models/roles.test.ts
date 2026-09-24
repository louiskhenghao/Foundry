import { describe, expect, test } from 'bun:test';
import { BUILTIN_PRESETS, builtinStatus, presetFingerprint, TaskDifficulty } from '@foundry/core';
import { modelFor, tableFor, workerModelFor } from './roles.ts';

const cfg = { modelPresets: {}, naturePreset: { code: 'production', docs: 'balanced', media: 'balanced' }, escalateLastAttempt: true };
const goal = (nature = 'code', modelPreset: string | null = null) => ({ nature: nature as never, modelPreset });

describe('model presets', () => {
  test('a goal reads its nature table from the preset Settings picks; its own preset wins; a missing preset falls back', () => {
    expect(tableFor(cfg, goal('code')).presetId).toBe('production');
    expect(modelFor(cfg, goal('code'), 'clarifier').model).toBe('fable');
    expect(modelFor(cfg, goal('code'), 'merger').model).toBe('opus');
    expect(tableFor(cfg, goal('image')).nature).toBe('media');
    expect(modelFor(cfg, goal('research'), 'goalReviewer').model).toBe(BUILTIN_PRESETS.balanced!.tables.docs.goalReviewer);
    expect(modelFor(cfg, goal('auto'), 'clarifier').model).toBe('fable'); // unclassified goals use the Code table
    expect(tableFor(cfg, goal('code', 'economy')).presetId).toBe('economy');
    expect(tableFor(cfg, goal('code', 'gone')).presetId).toBe('production');
  });
  test('an edited built-in or a preset of your own is read live from Settings', () => {
    const mine = { ...BUILTIN_PRESETS.balanced!, label: 'Cheap merges', tables: { ...BUILTIN_PRESETS.balanced!.tables, code: { ...BUILTIN_PRESETS.balanced!.tables.code, merger: 'haiku' } } };
    const c = { ...cfg, modelPresets: { mine }, naturePreset: { ...cfg.naturePreset, code: 'mine' } };
    expect(modelFor(c, goal('code'), 'merger').model).toBe('haiku');
    const edited = { ...BUILTIN_PRESETS.production!, basedOn: presetFingerprint(BUILTIN_PRESETS.production!), tables: { ...BUILTIN_PRESETS.production!.tables, code: { ...BUILTIN_PRESETS.production!.tables.code, merger: 'sonnet' } } };
    expect(builtinStatus('production', { production: edited })).toEqual({ builtin: true, modified: true, newerDefault: false });
    expect(builtinStatus('production', { production: { ...edited, basedOn: 'older' } }).newerDefault).toBe(true);
    expect(builtinStatus('production', {})).toEqual({ builtin: true, modified: false, newerDefault: false });
    expect(builtinStatus('mine', { mine })).toEqual({ builtin: false, modified: false, newerDefault: false });
  });
});

describe('worker routing', () => {
  const task = (difficulty: 'simple' | 'standard' | 'complex', retryBudget = 3) => ({ difficulty, retryBudget });
  test('difficulty picks the Simple / Standard / Complex row', () => {
    expect(workerModelFor(cfg, goal(), task('simple'), 1)).toEqual({ model: 'sonnet', escalated: null });
    expect(workerModelFor(cfg, goal(), task('standard'), 1)).toEqual({ model: 'opus', escalated: null });
    expect(workerModelFor(cfg, goal(), task('complex'), 1)).toEqual({ model: 'fable', escalated: null });
  });
  test('the last attempt of a budget ≥ 2 and human retries run on the Complex row; budget 1 never escalates', () => {
    expect(workerModelFor(cfg, goal(), task('standard', 3), 3)).toEqual({ model: 'fable', escalated: 'last-attempt' });
    expect(workerModelFor(cfg, goal(), task('standard', 3), 4)).toEqual({ model: 'fable', escalated: 'human-retry' });
    expect(workerModelFor(cfg, goal(), task('standard', 1), 1)).toEqual({ model: 'opus', escalated: null });
    expect(workerModelFor(cfg, goal(), task('complex', 3), 3)).toEqual({ model: 'fable', escalated: null });
    expect(workerModelFor({ ...cfg, escalateLastAttempt: false }, goal(), task('standard', 3), 3)).toEqual({ model: 'opus', escalated: null });
  });
  test('difficulty values of the first release replay as the new names', () => {
    expect(TaskDifficulty.parse('routine')).toBe('simple');
    expect(TaskDifficulty.parse('normal')).toBe('standard');
    expect(TaskDifficulty.parse('hard')).toBe('complex');
  });
});
