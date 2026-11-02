import { describe, expect, test } from 'bun:test';
import { EventStore, Goal, getAttempt, knownMigrationIds, openDatabase } from '@foundry/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { RestartGate, folderBytesAsync, prepareDataDir, readHomeConfig, rememberRecent, resolveDataDir, rewriteDataDirPaths, testDataDir, writeHomeConfig } from './data-dir.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-data-dir-'));
const goalRecord = (id: string, title: string, state: Goal['state']) => {
  const now = new Date().toISOString();
  return Goal.parse({ id, title, prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: `goal/${id}`, budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state, stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null, createdAt: now, updatedAt: now });
};

describe('which data folder opens (ADR-0082)', () => {
  test('FOUNDRY_DATA_DIR wins over the choice kept in ~/.foundry, which wins over the default', () => {
    const dir = tmp();
    try {
      const home = join(dir, 'home');
      const chosen = join(dir, 'chosen');
      mkdirSync(chosen);
      expect(resolveDataDir({ root: ROOT, provider: 'claude', env: {}, home })).toEqual({ path: join(ROOT, 'data'), source: 'default', missing: null });
      expect(resolveDataDir({ root: ROOT, provider: 'codex', env: {}, home })).toEqual({ path: join(ROOT, 'data-codex'), source: 'default', missing: null });
      writeHomeConfig(home, { dataDirs: { claude: chosen }, recent: [] });
      expect(resolveDataDir({ root: ROOT, provider: 'claude', env: {}, home })).toEqual({ path: chosen, source: 'config', missing: null });
      // keyed by launch profile: the Codex profile keeps its default
      expect(resolveDataDir({ root: ROOT, provider: 'codex', env: {}, home }).source).toBe('default');
      expect(resolveDataDir({ root: ROOT, provider: 'claude', env: { FOUNDRY_DATA_DIR: join(dir, 'env') }, home })).toEqual({ path: join(dir, 'env'), source: 'env', missing: null });
      // no home at all (tests): the default
      expect(resolveDataDir({ root: ROOT, provider: 'claude', env: {}, home: null }).source).toBe('default');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a chosen folder that is not there is not made: the default opens and the choice is kept for the next start', () => {
    const dir = tmp();
    try {
      const home = join(dir, 'home');
      const gone = join(dir, 'unmounted', 'foundry');
      writeHomeConfig(home, { dataDirs: { claude: gone }, recent: [] });
      const r = resolveDataDir({ root: ROOT, provider: 'claude', env: {}, home, log: () => {} });
      expect(r).toEqual({ path: join(ROOT, 'data'), source: 'default', missing: gone });
      expect(readHomeConfig(home).dataDirs.claude).toBe(gone);
      const cfg = defaultConfig(ROOT, { foundryHome: home, log: () => {} });
      expect([cfg.dataDir, cfg.dataDirSource, cfg.dataDirMissing]).toEqual([join(ROOT, 'data'), 'default', gone]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaultConfig under a test run reads no ~/.foundry, and an override says so', () => {
    expect(defaultConfig(ROOT).foundryHome).toBeNull();
    const cfg = defaultConfig(ROOT, { dataDir: '/tmp/x' });
    expect([cfg.dataDir, cfg.dataDirSource]).toEqual(['/tmp/x', 'override']);
  });

  test('an unreadable config is ignored, and the recent list keeps the folders left, newest first, without the one in use', () => {
    const dir = tmp();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), '{not json');
      const seen: string[] = [];
      expect(readHomeConfig(dir, (m) => seen.push(m))).toEqual({ dataDirs: {}, recent: [] });
      expect(seen[0]).toContain('could not read');
      expect(rememberRecent(['/a', '/b'], '/c', '/d')).toEqual(['/c', '/a', '/b']);
      expect(rememberRecent(['/a', '/b'], '/a', '/b')).toEqual(['/a']);
      expect(rememberRecent(['/1', '/2', '/3', '/4', '/5', '/6', '/7', '/8'], '/9', '/x')).toHaveLength(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the test a folder passes before a switch', () => {
  /** a data folder with a database, a provider marker and one goal */
  const foundryFolder = (at: string, provider = 'claude', goals = 1) => {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'provider'), provider);
    writeFileSync(join(at, 'version'), '2.17.0\n');
    const db = openDatabase(join(at, 'engine.db'));
    const store = new EventStore(db);
    for (let i = 0; i < goals; i++) store.append({ type: 'goal.created', goalId: `g_${i}`, payload: { goal: goalRecord(`g_${i}`, `goal ${i}`, 'draft') } });
    store.close();
  };
  const ids = (t: ReturnType<typeof testDataDir>) => Object.fromEntries(t.checks.map((c) => [c.id, c.ok]));

  test('the folder in use, one inside it, one around it and a relative path are refused', () => {
    const dir = tmp();
    try {
      const current = join(dir, 'data');
      mkdirSync(current);
      const opts = { current, provider: 'claude' as const, currentBytes: 0 };
      expect(testDataDir(current, opts)).toMatchObject({ kind: 'current', ok: false, modes: [] });
      expect(testDataDir(join(current, 'inner'), opts).checks[0]).toMatchObject({ id: 'path', ok: false, detail: 'inside the data folder in use' });
      expect(testDataDir(dir, opts).checks[0]).toMatchObject({ id: 'path', ok: false, detail: 'holds the data folder in use' });
      expect(testDataDir('data-2', opts).checks[0]).toMatchObject({ id: 'path', ok: false });
      expect(testDataDir('   ', opts).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an empty or missing folder may start blank, or take a copy when the disk has room; a folder with other things in it is refused', () => {
    const dir = tmp();
    try {
      const current = join(dir, 'data');
      mkdirSync(current);
      writeFileSync(join(current, 'engine.db'), 'x'.repeat(1000));
      const empty = join(dir, 'empty');
      mkdirSync(empty);
      writeFileSync(join(empty, '.DS_Store'), '');
      const t = testDataDir(empty, { current, provider: 'claude' });
      expect(t).toMatchObject({ kind: 'empty', ok: true, canClone: true, modes: ['blank', 'clone'], current: { path: current, bytes: 1000 } });
      expect(ids(t)).toEqual({ path: true, kind: true, writable: true, space: true });
      expect(t.checks.find((c) => c.id === 'space')!.detail).toMatch(/free; room for a copy of the current 1 KB/);
      // not there yet: made at the switch
      const missing = join(dir, 'new', 'deeper');
      expect(testDataDir(missing, { current, provider: 'claude', currentBytes: 0 })).toMatchObject({ kind: 'empty', ok: true });
      expect(testDataDir(missing, { current, provider: 'claude', currentBytes: 0 }).checks.find((c) => c.id === 'kind')!.detail).toBe('not there yet: it is created');
      // ~ expands
      expect(testDataDir('~/foundry-data-dir-test-nowhere', { current, provider: 'claude', currentBytes: 0 }).path).not.toContain('~');
      // other content
      const other = join(dir, 'other');
      mkdirSync(other);
      writeFileSync(join(other, 'notes.txt'), '');
      const o = testDataDir(other, { current, provider: 'claude', currentBytes: 0 });
      expect(o).toMatchObject({ kind: 'other', ok: false, modes: [] });
      expect(o.checks.find((c) => c.id === 'kind')!.detail).toContain('notes.txt');
      // a file
      expect(testDataDir(join(other, 'notes.txt'), { current, provider: 'claude', currentBytes: 0 }).checks.find((c) => c.id === 'kind')).toMatchObject({ ok: false, detail: 'a file, not a folder' });
      // no room for a copy of a huge current folder: blank only
      const big = testDataDir(empty, { current, provider: 'claude', currentBytes: Number.MAX_SAFE_INTEGER / 4 });
      expect(big).toMatchObject({ ok: true, canClone: false, modes: ['blank'] });
      expect(big.checks.find((c) => c.id === 'space')!.detail).toContain('not enough for a copy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a Foundry folder is opened when it belongs to this launch profile and no newer Foundry wrote it; what it holds is told", () => {
    const dir = tmp();
    try {
      const current = join(dir, 'data');
      mkdirSync(current);
      const mine = join(dir, 'mine');
      foundryFolder(mine, 'claude', 2);
      const t = testDataDir(mine, { current, provider: 'claude', currentBytes: 0 });
      expect(t).toMatchObject({ kind: 'foundry', ok: true, modes: ['open'], folder: { provider: 'claude', version: '2.17.0', goals: 2 } });
      expect(t.checks.find((c) => c.id === 'version')!.detail).toBe('2 goals, 2 events, last opened by Foundry 2.17.0');
      // the other coding agent's
      const theirs = join(dir, 'theirs');
      foundryFolder(theirs, 'codex');
      const o = testDataDir(theirs, { current, provider: 'claude', currentBytes: 0 });
      expect(o).toMatchObject({ kind: 'foundry', ok: false, modes: [] });
      expect(o.checks.find((c) => c.id === 'provider')).toMatchObject({ ok: false, detail: 'belongs to codex; this Foundry runs as claude (its launch profile)' });
      // a database with a migration this build does not know: written by a newer Foundry
      const newer = join(dir, 'newer');
      foundryFolder(newer);
      const db = openDatabase(join(newer, 'engine.db'));
      db.run("INSERT INTO _migrations (id, applied_at) VALUES ('9999-from-the-future', '2027-01-01')");
      db.close();
      const n = testDataDir(newer, { current, provider: 'claude', currentBytes: 0 });
      expect(n.ok).toBe(false);
      expect(n.checks.find((c) => c.id === 'version')!.detail).toBe('written by a newer Foundry (2.17.0): its database has 9999-from-the-future, which this one does not know');
      // the same database read with the migrations it has is fine
      expect(testDataDir(newer, { current, provider: 'claude', currentBytes: 0, knownMigrations: [...knownMigrationIds(), '9999-from-the-future'] }).ok).toBe(true);
      // a marker without a database yet (made, never booted)
      const bare = join(dir, 'bare');
      mkdirSync(bare);
      writeFileSync(join(bare, 'provider'), 'claude');
      expect(testDataDir(bare, { current, provider: 'claude', currentBytes: 0 })).toMatchObject({ kind: 'foundry', ok: true, modes: ['open'] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the copy a switch makes', () => {
  test('a clone holds the same events, and the paths that pointed into the old folder point into the copy; the old folder is untouched', async () => {
    const dir = tmp();
    try {
      const from = join(dir, 'data');
      const to = join(dir, 'moved');
      mkdirSync(join(from, 'transcripts'), { recursive: true });
      writeFileSync(join(from, 'provider'), 'claude');
      writeFileSync(join(from, 'transcripts', 'a_1.jsonl'), '{"cwd":"' + from + '/worktrees/x"}\n');
      writeFileSync(join(from, 'settings.json'), JSON.stringify({ engine: { workspacesRoot: join(from, 'ws') } }, null, 2));
      writeFileSync(join(from, 'preview-env.json'), JSON.stringify({ g_1: { OUT: `${from}/out`, OTHER: `${from}-codex/x`, REPO: '/repo' } }));
      const db = openDatabase(join(from, 'engine.db'));
      const store = new EventStore(db);
      const now = new Date().toISOString();
      store.append({ type: 'goal.created', goalId: 'g_1', payload: { goal: goalRecord('g_1', 'g', 'running') } });
      store.append({ type: 'attempt.started', goalId: 'g_1', payload: { attempt: { id: 'a_1', goalId: 'g_1', taskId: 't_1', index: 1, kind: 'work', sessionId: 's', model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: 7, cwd: '/repo-foundry/.foundry/x/tasks/t_1', transcriptPath: join(from, 'transcripts', 'a_1.jsonl'), startedAt: now, endedAt: null } as never } });
      const count = store.count();
      store.close();

      const made = await prepareDataDir(from, to, 'clone', () => {});
      expect(made.rewrote).toEqual({ events: 1, files: 2 });
      const copy = new EventStore(openDatabase(join(to, 'engine.db')));
      expect(copy.count()).toBe(count);
      // the read model was rebuilt from the rewritten log
      expect(getAttempt(copy.db, 'a_1')?.transcriptPath).toBe(join(to, 'transcripts', 'a_1.jsonl'));
      expect(getAttempt(copy.db, 'a_1')?.cwd).toBe('/repo-foundry/.foundry/x/tasks/t_1');
      copy.close();
      expect(JSON.parse(readFileSync(join(to, 'settings.json'), 'utf8')).engine.workspacesRoot).toBe(join(to, 'ws'));
      // a path that only starts like the old folder (data-codex beside data) is another folder
      expect(JSON.parse(readFileSync(join(to, 'preview-env.json'), 'utf8')).g_1).toEqual({ OUT: `${to}/out`, OTHER: `${from}-codex/x`, REPO: '/repo' });
      // transcripts are not rewritten (the session's own words), and the original is as it was
      expect(readFileSync(join(to, 'transcripts', 'a_1.jsonl'), 'utf8')).toContain(from);
      const orig = new EventStore(openDatabase(join(from, 'engine.db')));
      expect(getAttempt(orig.db, 'a_1')?.transcriptPath).toBe(join(from, 'transcripts', 'a_1.jsonl'));
      orig.close();
      expect(readFileSync(join(from, 'settings.json'), 'utf8')).toContain(join(from, 'ws'));
      // nothing to rewrite: the count says so
      expect(rewriteDataDirPaths(to, '/nowhere/at/all', '/elsewhere')).toEqual({ events: 0, files: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blank makes the folder and nothing else; open makes nothing', async () => {
    const dir = tmp();
    try {
      const to = join(dir, 'a', 'b');
      expect(await prepareDataDir(join(dir, 'data'), to, 'blank', () => {})).toEqual({ rewrote: null });
      expect(readdirSync(to)).toEqual([]);
      expect(await prepareDataDir(join(dir, 'data'), join(dir, 'c'), 'open', () => {})).toEqual({ rewrote: null });
      expect(existsSync(join(dir, 'c'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('the size of a folder is measured off the event loop, as the walk measures it to the kilobyte', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'a'), 'x'.repeat(50_000));
    const measured = await folderBytesAsync(dir);
    expect(measured).toBeGreaterThanOrEqual(50_000);
    expect(measured).toBeLessThan(200_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the restart gate', () => {
  test('a request wakes whoever waits, before or after it; a second request while one waits is dropped', async () => {
    const gate = new RestartGate();
    expect(gate.pendingRequest()).toBeNull();
    const first = gate.wait();
    gate.request({ kind: 'restart', why: 'asked' });
    gate.request({ kind: 'exit' });
    expect(await first).toEqual({ kind: 'restart', why: 'asked' });
    expect(gate.pendingRequest()).toEqual({ kind: 'restart', why: 'asked' });
    // a waiter arriving later gets the same pending request at once
    expect(await gate.wait()).toEqual({ kind: 'restart', why: 'asked' });
  });
});
