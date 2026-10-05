import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_CODEX_PRESETS, DEFAULT_SETTINGS } from '@foundry/core/browser';
import { CodexModelPresetsSection } from '../src/pages/settings/CodexModelPresets.tsx';
import { ModelPresetsSection } from '../src/pages/settings/ModelPresets.tsx';

const settings = () => structuredClone(DEFAULT_SETTINGS);
const codex = (draft = settings()) => renderToStaticMarkup(<CodexModelPresetsSection draft={draft} setFields={() => {}} />);
const claude = (draft = settings()) => renderToStaticMarkup(<ModelPresetsSection draft={draft} set={() => {}} known={[]} reloadModels={() => {}} />);
/** The panel's landmarks, in the order they appear. */
const at = (html: string, text: string) => html.search(new RegExp(`>(?:\\s|<!-- -->)*${text.replace(/[()]/g, '\\$&')}(?:<!-- -->)?<`));
const landmarks = (html: string, names: string[]) => names.map((n) => [n, at(html, n)] as const).filter(([, at]) => at >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n);
const SHARED = ['Sync models', 'Preset per goal type', 'Edit preset', 'Presets', 'New from this'];

describe('Models panels of both coding agents', () => {
  test('share one layout and vocabulary', () => {
    expect(landmarks(claude(), SHARED)).toEqual(SHARED);
    expect(landmarks(codex(), [...SHARED, 'Other models', 'Default Codex model', 'Fallbacks (in order)'])).toEqual([...SHARED, 'Other models', 'Default Codex model', 'Fallbacks (in order)']);
    for (const old of ['Sync Codex models', 'Duplicate preset', 'Fallback models, in order', 'Code preset<']) expect(codex()).not.toContain(old);
  });

  test('a Codex goal-type card lists every role as model · effort, with Default for the default model', () => {
    const html = codex();
    expect(html.match(/>Edit preset</g)?.length).toBe(3);
    expect(html).toContain(`Default · ${BUILTIN_CODEX_PRESETS.production!.tables.code.planner.effort}`);
    const draft = settings();
    draft.models.codexPresets = { production: { ...structuredClone(BUILTIN_CODEX_PRESETS.production!), basedOn: null } };
    draft.models.codexPresets.production!.tables.code.planner = { model: 'gpt-test', effort: 'high' };
    draft.models.codexPresets.production!.tables.code.simple = { model: 'codex-default', effort: null };
    const edited = codex(draft);
    expect(edited).toContain('gpt-test · high');
    expect(edited).toMatch(/title="Default">Default</);
    expect(edited).toContain('Production (modified)');
  });

  test('Codex editor rows keep the role on the left and model, effort and Test on the right', () => {
    const html = codex();
    expect(html).toContain('aria-label="Clarify model"');
    expect(html).toContain('aria-label="Clarify reasoning effort"');
    expect(html).toContain('aria-label="Test Clarify"');
    expect(html).toContain('aria-label="Housekeeping reasoning effort"');
  });
});
