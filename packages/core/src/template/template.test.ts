import { describe, expect, test } from 'bun:test';
import { YamlError, parseYaml, yamlString, yamlText, type YamlValue } from './yaml.ts';
import { inputsFor, labelOf, parseTemplateText, placeholdersOf, renderTemplate, settingsFromGoal, splitFrontmatter, templateFileText, templateFromGoal } from './template.ts';

describe('the frontmatter YAML', () => {
  test('reads maps, lists, scalars, flow lists and block scalars', () => {
    const v = parseYaml(`name: Product reel
summary: "A 30–60 s film: cut to music"
nature: video
count: 3
on: true
nothing:
settings:
  videoPack: motion-studio
  workflow:
    pace: fast
  budgets:
    maxCostUsd: 12.5
inputs:
  - key: product
    label: Product
    help: |
      What is shown.

      One line is enough.
  - key: length
    type: choice
    options: [30 s, 45 s, "60 s, or longer"]
    default: 45 s
  - key: audience
    help: >
      Who watches
      it.
tags:
  - launch
  - 'it''s short'
`);
    expect(v).toEqual({
      name: 'Product reel',
      summary: 'A 30–60 s film: cut to music',
      nature: 'video',
      count: 3,
      on: true,
      nothing: null,
      settings: { videoPack: 'motion-studio', workflow: { pace: 'fast' }, budgets: { maxCostUsd: 12.5 } },
      inputs: [
        { key: 'product', label: 'Product', help: 'What is shown.\n\nOne line is enough.' },
        { key: 'length', type: 'choice', options: ['30 s', '45 s', '60 s, or longer'], default: '45 s' },
        { key: 'audience', help: 'Who watches it.' },
      ],
      tags: ['launch', "it's short"],
    });
  });

  test('says which line it could not read', () => {
    expect(() => parseYaml('name: x\n\tbad: tab')).toThrow(YamlError);
    expect(() => parseYaml('name: x\n  stray: under a scalar')).toThrow(/line 2/);
    expect(() => parseYaml('inputs:\n  - key: a\n   label: three in')).toThrow(/line 3/);
    expect(() => parseYaml('name: *anchor')).toThrow(/quote it/);
    expect(() => parseYaml('name: x\nname: y')).toThrow(/given twice/);
    expect(() => parseYaml('name: "unclosed')).toThrow(/quote/);
    expect(parseYaml('')).toEqual({});
    expect(parseYaml('# only a comment\n')).toEqual({});
  });

  test('writes what it reads back, quoting only what needs it', () => {
    expect(yamlString('plain words')).toBe('plain words');
    expect(yamlString('true')).toBe('"true"');
    expect(yamlString('12')).toBe('"12"');
    expect(yamlString('a: b')).toBe('"a: b"');
    expect(yamlString(' spaced')).toBe('" spaced"');
    expect(yamlString('')).toBe('""');
    const value: YamlValue = { name: 'Reel: short', nature: 'video', settings: { workflow: { pace: 'fast' } }, inputs: [{ key: 'a', options: ['x', 'y z'], help: 'two\nlines' }, { key: 'b' }], empty: [] };
    const text = yamlText(value);
    expect(text).toBe(`name: "Reel: short"
nature: video
settings:
  workflow:
    pace: fast
inputs:
  - key: a
    options: [x, y z]
    help: |
      two
      lines
  - key: b
empty: []
`);
    expect(parseYaml(text)).toEqual(value);
  });
});

const FILE = `---
name: Product reel
summary: A short film about a product, cut to music.
nature: video
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: The product
    help: Its name, and what it does in one line.
  - key: length
    type: choice
    options: [30 s, 45 s, 60 s]
    default: 45 s
  - key: audience
    type: textarea
    required: false
  - key: unused
    label: Never named
---

Make a {{ length }} product reel for {{product}}.

Audience: {{audience}}
- Tone: {{tone}}

## Already decided
- One timeline, every format cut from it.
`;

describe('a template file', () => {
  test('splits the frontmatter from the body', () => {
    expect(splitFrontmatter('no frontmatter')).toEqual({ head: null, body: 'no frontmatter' });
    expect(splitFrontmatter('---\nname: a\n---\nbody')).toEqual({ head: 'name: a', body: 'body' });
    expect(splitFrontmatter('﻿---\r\nname: a\r\n---\r\nbody')).toEqual({ head: 'name: a', body: 'body' });
  });

  test('reads the frontmatter and makes the body placeholders its inputs, in the body order, as the frontmatter refines them', () => {
    const r = parseTemplateText(FILE, 'en');
    if ('error' in r) throw new Error(r.error);
    expect(r.template.name).toBe('Product reel');
    expect(r.template.nature).toBe('video');
    expect(r.template.settings).toEqual({ videoPack: 'motion-studio', mode: 'simple', budgetPreset: 'thorough' });
    expect(r.template.inputs.map((i) => i.key)).toEqual(['length', 'product', 'audience', 'tone']);
    expect(r.template.inputs[0]).toMatchObject({ key: 'length', type: 'choice', options: ['30 s', '45 s', '60 s'], default: '45 s' });
    expect(r.template.inputs[1]).toMatchObject({ key: 'product', label: 'The product', help: 'Its name, and what it does in one line.', type: 'text' });
    expect(r.template.inputs[2]).toMatchObject({ key: 'audience', type: 'textarea', required: false });
    // a placeholder nobody declared is a plain text input
    expect(r.template.inputs[3]).toEqual({ key: 'tone', type: 'text', other: false });
    expect(r.template.body.startsWith('Make a {{ length }}')).toBe(true);
    expect(r.warnings).toEqual(['the input "unused" is declared but the body never names {{unused}}']);
  });

  test('refuses what it cannot use, naming the mistake', () => {
    expect(parseTemplateText('just words', 'en')).toEqual({ error: expect.stringContaining('frontmatter') });
    expect(parseTemplateText('---\nnature: video\n---\nbody', 'en')).toEqual({ error: expect.stringMatching(/^name: /) });
    expect(parseTemplateText('---\nname: x\nnature: auto\n---\nbody', 'en')).toEqual({ error: expect.stringMatching(/^nature: /) });
    expect(parseTemplateText('---\nname: x\nnature: code\n---\n\n', 'en')).toEqual({ error: expect.stringContaining('cannot be empty') });
    expect(parseTemplateText('---\nname: x\nnature: code\nlang: zh\n---\nbody', 'en')).toEqual({ error: expect.stringContaining('lang: zh') });
    expect(parseTemplateText('---\nname: x\nnature: code\ninputs:\n  - key: 9lives\n---\nbody', 'en')).toEqual({ error: expect.stringMatching(/^inputs: 0\.key/) });
    expect(parseTemplateText('---\nname: x\nnature: code\nsettings:\n  budgetPreset: huge\n---\nbody', 'en')).toEqual({ error: expect.stringMatching(/^settings\.budgetPreset/) });
    expect(parseTemplateText('---\nname: x\n\tnature: code\n---\nbody', 'en')).toEqual({ error: 'frontmatter line 2: indent with spaces, not tabs' });
    expect(parseTemplateText(`---\nname: x\nnature: code\n---\n${'a'.repeat(70_000)}`, 'en')).toEqual({ error: expect.stringContaining('64 KB') });
  });

  test('writes a template back as a file that reads the same, leaving out what the body already says', () => {
    const r = parseTemplateText(FILE, 'en');
    if ('error' in r) throw new Error(r.error);
    const text = templateFileText(r.template);
    expect(text).toContain('name: Product reel\n');
    expect(text).toContain('nature: video\n');
    expect(text).toContain('  videoPack: motion-studio\n');
    // the plain `tone` input is not written: its placeholder says it; the others carry what they add
    expect(text).not.toContain('key: tone');
    expect(text).toContain('  - key: length\n    type: choice\n    options: [30 s, 45 s, 60 s]\n    default: 45 s\n');
    expect(text).toContain('  - key: audience\n    type: textarea\n    required: false\n');
    expect(text.endsWith('- One timeline, every format cut from it.\n')).toBe(true);
    const again = parseTemplateText(text, 'en');
    if ('error' in again) throw new Error(again.error);
    expect(again.template).toEqual({ ...r.template, inputs: r.template.inputs });
    expect(again.warnings).toEqual([]);
    // a 中文 twin says so in its frontmatter
    expect(templateFileText({ ...r.template, lang: 'zh' })).toContain('\nlang: zh\n');
  });
});

describe('rendering', () => {
  test('finds placeholders once each, in order, and names the inputs in words', () => {
    expect(placeholdersOf('{{b}} and {{ a }} then {{b}} {{not a key}} {{1x}}')).toEqual(['b', 'a']);
    expect(labelOf('product_name')).toBe('Product name');
    expect(labelOf('target-audience')).toBe('Target audience');
    expect(labelOf('maxLength')).toBe('Max length');
    expect(inputsFor('{{a}}', []).inputs).toEqual([{ key: 'a', type: 'text', other: false }]);
    expect(inputsFor('{{a}}', [{ key: 'a', type: 'choice', other: false }]).warnings).toEqual(['the choice "a" offers no options']);
  });

  test('fills the placeholders, uses defaults, drops the line of an empty optional input and lists what is missing', () => {
    const r = parseTemplateText(FILE, 'en');
    if ('error' in r) throw new Error(r.error);
    const empty = renderTemplate(r.template, {});
    expect(empty.missing).toEqual(['product', 'tone']);
    const done = renderTemplate(r.template, { product: ' Foundry ', tone: 'warm' });
    expect(done.missing).toEqual([]);
    expect(done.prompt).toBe('Make a 45 s product reel for Foundry.\n\n- Tone: warm\n\n## Already decided\n- One timeline, every format cut from it.');
    const full = renderTemplate(r.template, { product: 'Foundry', tone: 'warm', length: '60 s', audience: 'founders' });
    expect(full.prompt).toContain('Make a 60 s product reel for Foundry.\n\nAudience: founders\n- Tone: warm');
    // a heading that is just words and a colon stays: it never held a placeholder
    expect(renderTemplate({ body: 'Already decided:\n- x {{a}}', inputs: [{ key: 'a', type: 'text', other: false, required: false }] }, {}).prompt).toBe('Already decided:\n- x');
  });

  test('a template from a goal keeps its words as the body and its settings about the work', () => {
    const goal = {
      title: 'Make the toaster figure',
      prompt: 'A toaster with a lever that goes down.\n\nShow the heating elements inside.',
      nature: 'figure' as const,
      videoPack: null,
      figurePack: 'iso-glow' as const,
      mode: 'simple' as const,
      workflow: { pace: 'fast' as const, tdd: 'off' as const, ponytail: 'on' as const, profile: 'mattpocock' as const },
      budgetPreset: 'custom' as const,
      budgets: { maxCostUsd: 9, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: null },
      interview: { mode: 'auto' as const, depth: 2, status: 'thinking' as const, sessionId: null, rounds: [] },
    };
    const t = templateFromGoal(goal);
    expect(t).toEqual({
      lang: 'en',
      name: 'Make the toaster figure',
      summary: '',
      nature: 'figure',
      settings: { mode: 'simple', workflow: { pace: 'fast', tdd: 'off', ponytail: 'on', profile: 'mattpocock' }, budgetPreset: 'custom', interviewDepth: 2, figurePack: 'iso-glow', budgets: { maxCostUsd: 9, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 } },
      inputs: [],
      body: goal.prompt,
    });
    // the default custom limits are not worth writing; an auto nature falls back to code; a video goal carries its engine
    expect(settingsFromGoal({ ...goal, budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: null } }).budgets).toBeUndefined();
    expect(templateFromGoal({ ...goal, nature: 'auto' }).nature).toBe('code');
    expect(settingsFromGoal({ ...goal, nature: 'video', videoPack: 'motion-studio', figurePack: null }).videoPack).toBe('motion-studio');
    expect(settingsFromGoal({ ...goal, nature: 'video', videoPack: 'motion-studio', figurePack: null }).figurePack).toBeUndefined();
  });
});
