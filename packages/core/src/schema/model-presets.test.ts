import { describe, expect, test } from 'bun:test';
import { BUILTIN_CODEX_PRESETS, CodexModelPreset } from './codex-presets.ts';
import { BUILTIN_PRESETS, MODEL_ACTIONS, ModelPreset, presetFingerprint } from './model-presets.ts';

describe('the Conversation row of the model presets (ADR-0073)', () => {
  test('every shipped preset sets the Explainer, on every goal nature', () => {
    expect(MODEL_ACTIONS).toContain('explainer');
    for (const p of Object.values(BUILTIN_PRESETS)) for (const n of ['code', 'docs', 'media'] as const) expect(p.tables[n].explainer).toMatch(/^(fable|opus|sonnet|haiku)$/);
    expect(BUILTIN_PRESETS.production!.tables.code.explainer).toBe('opus');
    expect(BUILTIN_PRESETS.balanced!.tables.code.explainer).toBe('sonnet');
    for (const p of Object.values(BUILTIN_CODEX_PRESETS)) for (const n of ['code', 'docs', 'media'] as const) expect(p.tables[n].explainer.model).toBe('codex-default');
    expect(BUILTIN_CODEX_PRESETS.production!.tables.code.explainer.effort).toBe('medium');
  });

  test('a preset saved before the row existed reads with its Suggest model as the Explainer, so Settings still load', () => {
    const { explainer: _e, ...older } = BUILTIN_PRESETS.balanced!.tables.code;
    const saved = { label: 'Mine', description: '', basedOn: null, tables: { code: older, docs: older, media: older } };
    const parsed = ModelPreset.parse(saved);
    expect(parsed.tables.code.explainer).toBe(older.suggest);
    // the fingerprint names every row, the new one included: an edited built-in is told the shipped one changed
    expect(presetFingerprint(parsed).split('|')[0]!.split(',')).toHaveLength(MODEL_ACTIONS.length);

    const { explainer: _c, ...olderCodex } = BUILTIN_CODEX_PRESETS.balanced!.tables.code;
    const codex = CodexModelPreset.parse({ label: 'Mine', description: '', basedOn: null, tables: { code: olderCodex, docs: olderCodex, media: olderCodex } });
    expect(codex.tables.code.explainer).toEqual(olderCodex.suggest);
  });
});
