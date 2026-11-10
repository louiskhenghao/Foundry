import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionChipNav, SectionSideNav } from '../src/components/SectionNav.tsx';
import { sectionOf } from '../src/pages/settings/section-of.ts';

const page = readFileSync(join(import.meta.dir, '../src/pages/SettingsPage.tsx'), 'utf8');
/** the sections of the page, as the guide test reads them */
const sections = [...(page.match(/const SECTIONS[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]!);

test('every setting the page edits sits in one of its sections, so its unsaved change is counted somewhere', () => {
  expect(sections.length).toBeGreaterThan(10);
  const paths = new Set([...page.matchAll(/'((?:workflow|reviews|delivery|sync|models|sessions|engine|tools|preview|checks|notifications|safety|beta)\.[a-zA-Z]+)'/g)].map((m) => m[1]!));
  expect(paths.size).toBeGreaterThan(80);
  const lost = [...paths].filter((p) => !sections.includes(sectionOf(p) ?? ''));
  expect(lost).toEqual([]);
});

test('a setting edited beside its neighbours in another section counts there', () => {
  expect(sectionOf('workflow.tdd')).toBe('goals');
  expect(sectionOf('reviews.maxFixCycles')).toBe('goals');
  expect(sectionOf('delivery.defaultMode')).toBe('goals');
  expect(sectionOf('delivery.vercelToken')).toBe('git');
  expect(sectionOf('sync.startFrom')).toBe('git');
  expect(sectionOf('workflow.designPack')).toBe('skills');
  expect(sectionOf('workflow.investigationMaxMinutes')).toBe('models');
  expect(sectionOf('engine.maxConcurrent')).toBe('models');
  expect(sectionOf('engine.port')).toBe('engine');
  expect(sectionOf('checks.selfCheck')).toBe('preview');
  // set elsewhere (the Accounts page, the Learnings page): no section of this page counts it
  expect(sectionOf('accounts.autoSwitchClaude')).toBeNull();
  expect(sectionOf('memory.reflectSec')).toBeNull();
});

test('a menu with a choice marks the chosen section and shows the unsaved count of another on a plate', () => {
  const items = [
    { id: 'goals', label: 'New goal defaults', dot: 'bg-code-0', status: null, warn: false },
    { id: 'models', label: 'Models & limits', dot: 'bg-code-2', status: '2', warn: true },
  ];
  for (const Nav of [SectionSideNav, SectionChipNav]) {
    const h = renderToStaticMarkup(<Nav items={items} label="Settings sections" choice={{ current: 'models', onSelect: () => {} }} />);
    const buttons = h.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).not.toContain('aria-current');
    expect(buttons[1]).toContain('aria-current="location"');
    expect(h).toContain('bg-you');
    expect(h).toContain('>2<');
  }
});
