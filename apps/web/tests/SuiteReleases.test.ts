import { expect, test } from 'bun:test';
import type { ReleaseForecast, SuiteReleaseView } from '@foundry/engine/skills-types';
import { forecastLine, pinnedBy, releaseState, usedBy, workflowLosses } from '../src/pages/skills/release-notes.ts';

const forecast: ReleaseForecast = {
  from: 'v1.3.1',
  to: 'v1.4.0',
  removed: [
    { name: 'grilling', deprecated: true, inCatalog: true, rules: [{ role: 'clarifier', mandate: 'prefer' }], notes: [] },
    { name: 'tdd', deprecated: false, inCatalog: true, rules: [{ role: 'worker', mandate: 'must' }, { role: 'planner', mandate: 'prefer' }], notes: [] },
    { name: 'wait-what', deprecated: false, inCatalog: false, rules: [], notes: [] },
    { name: 'retro', deprecated: false, inCatalog: true, rules: [], notes: [] },
  ],
  added: ['teach', 'wizard'],
  kept: 9,
  headlines: [],
};
const view = (o: Partial<SuiteReleaseView>): SuiteReleaseView => ({ id: 'mattpocock', label: 'mattpocock', kind: 'bundle', repo: 'mattpocock/skills', homepage: null, catalogRef: 'v1.3.1', chosenRef: null, ref: 'v1.3.1', installed: { as: 'plugin', ref: 'v1.3.1' }, choices: ['v1.4.0', 'v1.3.1'], latest: 'v1.4.0', forecast, checkedAt: null, error: null, ...o });

test("a removed skill says what Foundry's workflow does with it; only the catalog's count as losses", () => {
  expect(usedBy(forecast.removed[1]!)).toBe('workers must use it, the planner prefers it');
  expect(usedBy(forecast.removed[0]!)).toBe('the Clarifier prefers it');
  expect(usedBy(forecast.removed[3]!)).toBe("it is in Foundry's catalog");
  expect(usedBy(forecast.removed[2]!)).toBeNull();
  expect(workflowLosses(forecast).map((s) => s.name)).toEqual(['grilling', 'tdd', 'retro']);
  expect(workflowLosses(null)).toEqual([]);
  expect(forecastLine(forecast)).toBe('+2 new · 4 removed (1 deprecated) · 9 stay');
});

test("a release's state: not installed, out of step with the release in use, a newer one out, or the newest", () => {
  expect(releaseState(view({ installed: null }))).toEqual({ badge: 'pending', text: 'not installed' });
  expect(releaseState(view({ ref: 'v1.4.0', chosenRef: 'v1.4.0', forecast: null }))).toEqual({ badge: 'update-available', text: 're-sync to v1.4.0' });
  expect(releaseState(view({ installed: { as: 'plugin', ref: null } }))).toEqual({ badge: 'update-available', text: 'not pinned' });
  expect(releaseState(view({}))).toEqual({ badge: 'update-available', text: 'v1.4.0 available' });
  expect(releaseState(view({ forecast: null, latest: 'v1.3.1' }))).toEqual({ badge: 'up-to-date', text: 'newest release' });
  expect(pinnedBy(view({}))).toBe('pinned by Foundry');
  expect(pinnedBy(view({ chosenRef: 'v1.4.0', ref: 'v1.4.0' }))).toBe('moved by you · Foundry pins v1.3.1');
});
