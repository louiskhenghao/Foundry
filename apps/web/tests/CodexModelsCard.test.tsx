import { describe, expect, test } from 'bun:test';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_CODEX_PRESETS, CODEX_MODEL_ACTIONS, MODEL_NATURES } from '@foundry/core/browser';
import { CodexModelsCard } from '../src/pages/goal/CodexModelsCard.tsx';

type ModelGoal = ComponentProps<typeof CodexModelsCard>['goal'];
function fixture(): ModelGoal {
  const preset = structuredClone(BUILTIN_CODEX_PRESETS.production!);
  preset.label = 'Captured custom preset';
  for (const nature of MODEL_NATURES) for (const action of CODEX_MODEL_ACTIONS) preset.tables[nature][action].model = `${nature}-${action}`;
  return { provider: 'codex', nature: 'video', modelPreset: 'custom', codexPreset: preset, codexFallbacks: ['backup-first', 'backup-second'], modelSubstitutions: {}, effort: null, models: { worker: 'old-worker', strong: 'old-strong', cheap: 'old-cheap' } };
}
const render = (goal: ModelGoal) => renderToStaticMarkup(<CodexModelsCard goal={goal} />);

describe('captured Codex models on a goal', () => {
  test('shows every saved role and nature table, opening the current effective nature', () => {
    const html = render(fixture());
    expect(html).toContain('Captured custom preset');
    expect(html).toContain('Later Settings edits do not change this snapshot');
    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>Media · current/);
    expect(html).toContain('Docs &amp; research · saved table');
    for (const nature of MODEL_NATURES) for (const action of CODEX_MODEL_ACTIONS) expect(html).toContain(`${nature}-${action}`);
    expect(html).toContain('backup-first → backup-second');
    expect(html).not.toContain('old-worker');
  });

  test('shows effective replacements, bounded like the engine, while retaining the captured model', () => {
    const goal = fixture();
    goal.modelSubstitutions = { 'media-planner': 'first', first: 'second', second: 'third', third: 'fourth', fourth: 'fifth' };
    const html = render(goal);
    expect(html).toContain('media-planner → first → second → third → fourth');
    expect(html).not.toContain('fifth');
    expect(html).toMatch(/>fourth<div/);
  });

  test('shows a goal-wide override alongside the saved role effort, retaining full native effort values', () => {
    const goal = fixture();
    goal.effort = 'none';
    goal.codexPreset!.tables.media.planner.effort = 'ultra';
    const html = render(goal);
    expect(html).toContain('Goal-wide reasoning override:');
    expect(html).toContain('saved: ultra');
    expect(html).toMatch(/>none<div/);
  });

  test('explains native defaults and the provisional code table for unclassified goals', () => {
    const goal = fixture();
    goal.nature = 'auto';
    goal.codexPreset!.tables.code.planner = { model: 'codex-default', effort: null };
    const html = render(goal);
    expect(html).toContain('until the goal’s nature is classified');
    expect(html).toContain('CLI default model');
    expect(html).toContain('CLI default');
    expect(html).not.toContain('codex-default');
  });

  test('legacy goals show their actual single model and legacy max reasoning without inventing a preset', () => {
    const goal = fixture();
    delete goal.codexPreset;
    delete goal.codexFallbacks;
    goal.effort = 'max';
    goal.modelSubstitutions = { 'old-worker': 'replacement' };
    const html = render(goal);
    expect(html).toContain('Legacy single-model goal');
    expect(html).toContain('old-worker → replacement');
    expect(html).toContain('old-cheap');
    expect(html).toContain('xhigh (legacy max)');
    expect(html).toContain('without a captured fallback list do not try additional models');
    expect(html).not.toContain('Captured custom preset');
    expect(html).not.toContain('<table');
  });

  test('Claude goals receive no Codex card', () => {
    expect(render({ ...fixture(), provider: 'claude' })).toBe('');
  });
});
