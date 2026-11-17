import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { keepProvider, launchProfile, readHomeConfig, writeHomeConfig } from '../data-dir.ts';
import type { EarlierInstall } from './find.ts';
import { type MoveItem, profileAfterMove } from './move.ts';
import { tmp } from './test-helpers.ts';

test('a release install starts with the launch profile its goals were moved into; FOUNDRY_PROVIDER still names one, and a checkout never follows (ADR-0107)', () => {
  const home = tmp();
  try {
    expect(launchProfile({ env: {}, home, kind: 'app' })).toBe('claude');
    keepProvider(home, 'codex');
    expect(readHomeConfig(home).provider).toBe('codex');
    expect(launchProfile({ env: {}, home, kind: 'app' })).toBe('codex');
    expect(launchProfile({ env: {}, home, kind: 'binary' })).toBe('codex');
    expect(launchProfile({ env: { FOUNDRY_PROVIDER: 'agy' }, home, kind: 'app' })).toBe('agy');
    // a dev server shares ~/.foundry with the app: it keeps its own profile
    expect(launchProfile({ env: {}, home, kind: 'checkout' })).toBe('claude');
    expect(launchProfile({ env: {}, home: null, kind: 'app' })).toBe('claude');
    // the rest of the record stays as it was
    writeHomeConfig(home, { ...readHomeConfig(home), port: 4123 });
    keepProvider(home, 'claude');
    expect(readHomeConfig(home)).toMatchObject({ provider: 'claude', port: 4123 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const install = (env: Record<string, string> = {}): EarlierInstall => ({ id: 'source:/old', kind: 'source', where: '/old', version: '2.35.0', recorded: true, running: null, port: 4111, url: null, folders: [], goals: 0, last: null, env, docker: null });
const item = (provider: 'claude' | 'codex' | 'agy', goals: number, action: MoveItem['action'] = 'copy'): MoveItem => ({ provider, from: `/old/${provider}`, to: `/new/${provider}`, action, why: '', counts: { goals, events: goals, last: null } });

test("goals made with another coding agent move in with its launch profile, and never hide goals this install has (ADR-0107)", () => {
  // the same profile: nothing to switch
  expect(profileAfterMove({ install: install(), items: [item('claude', 3)], running: 'claude', ownGoals: 0 })).toEqual({ switchTo: null, refuse: null });
  // a Codex install into a fresh app: the app runs Codex's launch profile from then on
  expect(profileAfterMove({ install: install({ FOUNDRY_PROVIDER: 'codex' }), items: [item('codex', 3)], running: 'claude', ownGoals: 0 })).toEqual({ switchTo: 'codex', refuse: null });
  // the profile it ran is not known: the folder with the goals says it (an empty one of the other profile beside it)
  expect(profileAfterMove({ install: install(), items: [item('claude', 0), item('codex', 5)], running: 'claude', ownGoals: 0 }).switchTo).toBe('codex');
  // the old install's own profile wins while its folder has goals
  expect(profileAfterMove({ install: install({ FOUNDRY_PROVIDER: 'claude' }), items: [item('claude', 2), item('codex', 5)], running: 'claude', ownGoals: 0 }).switchTo).toBeNull();
  // goals of this install's own in the profile it runs: refused before anything stops, unless the person sets them aside
  const mine = profileAfterMove({ install: install({ FOUNDRY_PROVIDER: 'codex' }), items: [item('codex', 3)], running: 'claude', ownGoals: 4 });
  expect(mine.switchTo).toBeNull();
  expect(mine.refuse).toContain("Codex's launch profile");
  expect(profileAfterMove({ install: install({ FOUNDRY_PROVIDER: 'codex' }), items: [item('codex', 3)], running: 'claude', ownGoals: 4, replace: true })).toEqual({ switchTo: 'codex', refuse: null });
  // a folder chosen in Settings counts as well; a move of no goals switches nothing
  expect(profileAfterMove({ install: install(), items: [item('codex', 2, 'keep')], running: 'claude', ownGoals: 0 }).switchTo).toBe('codex');
  expect(profileAfterMove({ install: install(), items: [item('codex', 0)], running: 'claude', ownGoals: 0 }).switchTo).toBeNull();
  // what does not move says nothing
  expect(profileAfterMove({ install: install({ FOUNDRY_PROVIDER: 'codex' }), items: [item('codex', 3, 'conflict')], running: 'claude', ownGoals: 0 }).switchTo).toBeNull();
});
