import { describe, expect, test } from 'bun:test';
import type { SkillSource, SkillSourceRow, SkillUsage } from '@foundry/engine/skills-types';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rowFilter, usageNote } from '../src/pages/skills/SkillsPage.tsx';
import { SourceGroup } from '../src/pages/skills/SourceGroup.tsx';

const row = (name: string, scope: SkillSourceRow['scope'] = 'user'): SkillSourceRow => ({ name, invoke: name, description: `${name} skill`, dir: `/skills/${name}`, scope, managedBy: null, status: 'up-to-date', local: { commit: null, installedAt: null, updatedAt: null, version: null }, pathInRepo: null, upstream: null, match: null, shadowedBy: null, duplicateOf: [], catalogId: null, actions: [] });
const source = (skills: SkillSourceRow[]): SkillSource => ({ id: 'local', kind: 'local', label: 'Hand-installed', manager: 'hand', repo: null, homepage: null, local: { commit: null, version: null, installedAt: null, updatedAt: null }, upstream: null, updateAvailable: null, updater: { kind: 'none', command: null, hint: null }, error: null, skills });
const used = (goals: number): SkillUsage => ({ goals, sessions: goals + 2, lastUsedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), unused: false });
const unused: SkillUsage = { goals: 0, sessions: 0, lastUsedAt: null, unused: true };
const usage = new Map<string, SkillUsage | null>([['/skills/tdd', used(4)], ['/skills/grill', unused], ['/skills/brainstorm', unused], ['/skills/learnings', null], ['/skills/diagnose', used(1)]]);
const actions = { onUpdate: () => {}, onAdopt: () => {}, onTrashShadows: () => {}, onUninstall: () => {}, onView: () => {}, selected: new Set<string>(), onSelect: () => {} };
// opened, as a search opens every source with a match: a source starts closed, its skills hidden under its row
const group = (skills: SkillSourceRow[], windowGoals = 7, expand = true) => renderToStaticMarkup(<SourceGroup s={source(skills)} busy={false} updating={false} filter={() => true} expand={expand} a={actions} usage={usage} windowGoals={windowGoals} />);

describe('a source of skills', () => {
  test('starts closed: its row says how many skills it has, the skills themselves stay hidden', () => {
    const html = group([row('tdd'), row('diagnose')], 7, false);
    expect(html).toContain('2 skills');
    expect(html).not.toContain('used in 4 goals');
    expect(html).toContain('aria-expanded="false"');
  });
  test('a search or a filter opens it', () => expect(group([row('tdd')])).toContain('aria-expanded="true"'));
});

describe('skill usage on a row', () => {
  test('a used row says in how many goals and when it was last invoked', () => {
    const html = group([row('tdd'), row('diagnose')]);
    expect(html).toContain('used in 4 goals · last 2d ago');
    expect(html).toContain('used in 1 goal · last 2d ago');
    expect(html).not.toContain('>unused<');
  });
  test('an unused row carries the amber chip, titled with the goals actually counted', () => {
    const html = group([row('grill')]);
    expect(html).toContain('title="no session invoked it in the last 7 goals"');
    expect(html).toContain('>unused</span>');
    expect(group([row('grill')], 30)).toContain('title="no session invoked it in the last 30 goals"');
  });
  test('a project row shows neither', () => {
    const html = group([row('learnings', 'project')]);
    expect(html).not.toContain('used in');
    expect(html).not.toContain('unused');
  });
});

describe('unused only', () => {
  const rows = [row('tdd'), row('grill'), row('brainstorm', 'plugin'), row('learnings', 'project')];
  const keep = (f: Partial<Parameters<typeof rowFilter>[0]>) => rows.filter(rowFilter({ scope: 'all', q: '', onlyOutdated: false, onlyUnused: false, usage, ...f })).map((r) => r.name);
  test('keeps only the rows no session used', () => expect(keep({ onlyUnused: true })).toEqual(['grill', 'brainstorm']));
  test('combines with the scope buttons and the search', () => {
    expect(keep({ onlyUnused: true, scope: 'plugin' })).toEqual(['brainstorm']);
    expect(keep({ onlyUnused: true, q: 'GRILL' })).toEqual(['grill']);
    expect(keep({ onlyUnused: true, onlyOutdated: true })).toEqual([]);
  });
});

describe('the note under the heading', () => {
  const installed = [...usage.values()].map((u) => ({ usage: u }));
  test('counts the unused user and plugin rows over the goals found', () => {
    expect(usageNote(installed, { goals: 7, limit: 30 })).toBe('2 of 4 installed skills were never used in the last 7 goals');
    expect(usageNote(installed, { goals: 30, limit: 30 })).toBe('2 of 4 installed skills were never used in the last 30 goals');
  });
  test('no goals yet: usage is unknown', () => expect(usageNote(installed, { goals: 0, limit: 30 })).toBe('No goals yet: skill usage is unknown'));
  test('nothing when usage was not computed', () => expect(usageNote(installed, null)).toBeNull());
});
