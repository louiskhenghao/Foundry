import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Learning } from '@foundry/core/browser';
import { LearningDialog, LearningRow, applyChange } from '../src/pages/LearningsPage.tsx';

const learning = (over: Partial<Learning> = {}): Learning => ({ id: 'l1', kind: 'test', text: 'Run `bun test` from the root.', by: 'foundry', goalId: 'g1', goalTitle: 'Newsletter sign-up', at: new Date(Date.now() - 2 * 86_400_000).toISOString(), ...over });

test('one change at a time, made on the latest list: added at the end, changed in place, removed', () => {
  const list = [
    { id: 'a', kind: 'build' as const, text: 'one' },
    { id: 'b', kind: 'test' as const, text: 'two' },
  ];
  expect(applyChange(list, { id: null, kind: 'pitfall', text: 'three' })).toEqual([...list, { id: null, kind: 'pitfall', text: 'three' }]);
  expect(applyChange(list, { id: 'a', kind: 'run', text: 'one, changed' })).toEqual([{ id: 'a', kind: 'run', text: 'one, changed' }, list[1]!]);
  expect(applyChange(list, { remove: 'a' })).toEqual([list[1]!]);
  // a goal rewrote the notebook meanwhile and the learning is gone: the person's change comes back as a new one
  expect(applyChange([list[1]!], { id: 'a', kind: 'run', text: 'one, changed' })).toEqual([list[1]!, { id: null, kind: 'run', text: 'one, changed' }]);
});

test('a learning reads in two columns: its kind at one width, then the text over where it came from', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <LearningRow l={learning()} onEdit={() => {}} />
      </ul>
    </MemoryRouter>,
  );
  expect(html).toMatch(/^<ul><li class="flex items-start gap-3[^"]*"><span class="w-20 shrink-0 pt-0.5"><span class="[^"]*">test<\/span><\/span><div class="min-w-0 flex-1"><p class="[^"]*">Run `bun test` from the root.<\/p><div /);
  expect(html).toMatch(/from <a class="[^"]*" href="\/goals\/g1">Newsletter sign-up<\/a> · 2d ago<\/span>/);
  // one link-like button changes it; a phone's 32px button height would push the line apart
  expect(html).toMatch(/<button type="button" class="relative ml-auto[^"]*" style="min-height:0" aria-label="Edit this learning"/);
  const yours = renderToStaticMarkup(
    <MemoryRouter>
      <ul>
        <LearningRow l={learning({ by: 'human', goalId: null, goalTitle: null })} />
      </ul>
    </MemoryRouter>,
  );
  expect(yours).toContain('✎ yours');
  expect(yours).not.toContain('Edit this learning');
});

test('a learning is added, changed or removed in a window with room to write it', () => {
  const add = renderToStaticMarkup(<LearningDialog repoPath="/x/studio-site" learning={null} onClose={() => {}} onSaved={() => {}} />);
  expect(add).toContain('>Add a learning</h3>');
  expect(add).toContain('rows="6"');
  expect(add).not.toContain('Remove');
  // nothing written yet, nothing to add
  expect(add).toMatch(/<button class="[^"]*" disabled="">Add<\/button>/);
  const edit = renderToStaticMarkup(<LearningDialog repoPath="/x/studio-site" learning={learning()} onClose={() => {}} onSaved={() => {}} />);
  expect(edit).toContain('>Edit learning</h3>');
  expect(edit).toContain('>Run `bun test` from the root.</textarea>');
  expect(edit).toContain('Remove');
  // unchanged, nothing to save yet
  expect(edit).toMatch(/<button class="[^"]*" disabled="">Save<\/button>/);
});
