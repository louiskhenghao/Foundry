import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, getTask, isHistory, listAttemptsByGoal, type Goal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, waitFor } from '../test-helpers.ts';
import { packTransfer, unpackTransfer } from './archive.ts';
import { engineTransferHost, exportTransfer } from './export.ts';
import { applyIncoming, inspectIncoming, matchRepo, newerRelease, receiveTransfer, sameRemote, unlockIncomingSecrets } from './import.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let tmp: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'foundry-import-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [tmp, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

function engine(name: string, runner = new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'))) {
  const dataDir = join(tmp, name);
  const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), alwaysReviewTasks: false, log: () => {} }), runner);
  engines.push(e);
  return { e, runner };
}

/** the old computer: a finished goal, and one cut off mid-attempt (its session was running when it was exported) */
async function oldComputer() {
  const { e: a } = engine('a');
  const done = await a.createGoal({ prompt: 'create done.txt', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
  await waitFor(() => ['done', 'over_delivered'].includes(getGoal(a.store.db, done.id)!.state), 30_000);
  a.beginUpdateDrain();
  const now = new Date().toISOString();
  const cut: Goal = { ...getGoal(a.store.db, done.id)!, id: 'g_cut', title: 'cut off', state: 'running', branch: 'goal/g_cut', workspaceDir: null, delivery: getGoal(a.store.db, done.id)!.delivery, costUsd: 0, createdAt: now, updatedAt: now };
  a.store.append({ type: 'goal.created', goalId: 'g_cut', payload: { goal: cut } });
  a.store.append({ type: 'task.created', goalId: 'g_cut', payload: { task: { ...getTask(a.store.db, listAttemptsByGoal(a.store.db, done.id)[0]!.taskId)!, id: 't_cut', goalId: 'g_cut', state: 'running', extraAttempts: 0 } } });
  a.store.append({ type: 'attempt.started', goalId: 'g_cut', payload: { attempt: { id: 'a_cut', goalId: 'g_cut', taskId: 't_cut', index: 1, kind: 'work', sessionId: 'sess-on-old-mac', model: null, state: 'running', costUsd: 0.5, numTurns: 3, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: join(a.config.dataDir, 'transcripts', 'a_cut.jsonl'), startedAt: now, endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } } });
  a.updateSettings({ models: { cheap: 'sonnet' }, tools: { openaiApiKey: 'sk-old-mac-0123456' } });
  a.preview.env.set(repo, { DATABASE_URL: 'postgres://old' }, 0);
  const file = join(tmp, 'move.tgz');
  await exportTransfer(engineTransferHost(a), { categories: { settings: true, secrets: true, goals: true, transcripts: true }, password: 'pw', out: file });
  return { a, file, doneId: done.id };
}

describe('import (ADR-0030)', () => {
  test('a Transfer file merges into another Foundry: goals as history, settings and credentials as chosen', async () => {
    const { file, doneId } = await oldComputer();
    const { e: b, runner } = engine('b');
    b.updateSettings({ models: { presetDocs: 'economy' }, delivery: { defaultMode: 'pr' } });

    const report = await receiveTransfer(b, file);
    expect(report.goals.map((g) => [g.id, g.status, g.unfinished])).toEqual([[doneId, 'new', false], ['g_cut', 'new', true]]);
    // the same path with the same (no) remote is the same repository
    expect(report.repos).toEqual([{ original: repo, remoteUrl: null, goals: [doneId, 'g_cut'], match: repo }]);
    expect(report.settings).toEqual([{ section: 'models', keys: ['models.cheap', 'models.presetDocs'] }, { section: 'delivery', keys: ['delivery.defaultMode'] }]);
    expect(report.secrets).toBe(true);
    expect(() => unlockIncomingSecrets(b, report.uploadId, 'nope')).toThrow('wrong password');
    expect(unlockIncomingSecrets(b, report.uploadId, 'pw')).toEqual({ settings: [{ key: 'tools.openaiApiKey', imported: 'sk-o…3456', mine: null, same: false }], previewEnv: [{ repo, keys: ['DATABASE_URL'] }] });

    const applied = await applyIncoming(b, report.uploadId, { settings: { delivery: 'mine' }, secrets: { password: 'pw', keepMine: [] } });
    expect(applied.imported.map((g) => g.id)).toEqual([doneId, 'g_cut']);
    expect(applied.settings.sort()).toEqual(['models.cheap', 'models.presetDocs']);
    expect(applied.secrets).toEqual(['tools.openaiApiKey']);
    expect(applied.previewEnv).toEqual({ applied: [repo], waiting: [] });
    expect(applied.repos).toEqual([{ original: repo, to: repo, error: null }]);
    expect(b.settings.values().models.cheap).toBe('sonnet');
    expect(b.settings.values().delivery.defaultMode).toBe('pr');
    expect(b.settings.values().tools.openaiApiKey).toBe('sk-old-mac-0123456');
    expect(b.preview.env.get(repo).vars).toEqual({ DATABASE_URL: 'postgres://old' });

    // history: nothing runs; the cut-off attempt is closed and its retry given back
    const cut = getGoal(b.store.db, 'g_cut')!;
    expect(isHistory(cut)).toBe(true);
    expect(cut.transfer).toMatchObject({ unfinished: true, transcripts: false, original: { repoPath: repo } });
    expect(listAttemptsByGoal(b.store.db, 'g_cut')[0]).toMatchObject({ state: 'error', resultSubtype: 'transferred', transcriptPath: join(b.config.dataDir, 'transcripts', 'a_cut.jsonl') });
    expect(getTask(b.store.db, 't_cut')).toMatchObject({ state: 'ready', extraAttempts: 1 });
    expect(getGoal(b.store.db, doneId)!.transfer?.bundle).toBe(`transfer/goals/${doneId}/branch.bundle`);
    await new Promise((r) => setTimeout(r, 200));
    expect(runner.calls).toEqual([]);
    const snap = b.store.snapshotReadModels();
    b.store.replay();
    expect(b.store.snapshotReadModels()).toEqual(snap);

    // the same file again: everything is already here
    const again = await receiveTransfer(b, file);
    expect(again.goals.map((g) => g.status)).toEqual(['here', 'here']);
    expect((await applyIncoming(b, again.uploadId, {})).skipped.map((s) => s.reason)).toEqual(['already here', 'already here']);
  });

  test('goals can be chosen; a goal deleted here stays deleted; preview variables of an unknown repository wait', async () => {
    const { file, doneId } = await oldComputer();
    const { e: b } = engine('b');
    const first = await receiveTransfer(b, file);
    await applyIncoming(b, first.uploadId, { goals: [doneId], repos: { [repo]: null }, secrets: { password: 'pw', keepMine: ['tools.openaiApiKey'] } }).then((r) => {
      expect(r.imported.map((g) => g.id)).toEqual([doneId]);
      expect(r.secrets).toEqual([]);
      expect(r.previewEnv).toEqual({ applied: [], waiting: [repo] });
    });
    expect(getGoal(b.store.db, 'g_cut')).toBeNull();
    await b.deleteGoal(doneId);
    const second = await receiveTransfer(b, file);
    expect(second.goals.map((g) => [g.id, g.status])).toEqual([[doneId, 'deleted-here'], ['g_cut', 'new']]);
  });

  test('a file from a newer Foundry is refused; a file of an older format reads with defaults', async () => {
    const { file } = await oldComputer();
    const { e: b } = engine('b');
    const x = join(tmp, 'x');
    await unpackTransfer(file, x);
    const manifest = JSON.parse(readFileSync(join(x, 'manifest.json'), 'utf8'));
    writeFileSync(join(x, 'manifest.json'), JSON.stringify({ ...manifest, release: '99.0.0' }));
    await packTransfer(x, join(tmp, 'newer.tgz'));
    await expect(receiveTransfer(b, join(tmp, 'newer.tgz'))).rejects.toThrow('newer than this one');
    writeFileSync(join(x, 'manifest.json'), JSON.stringify({ ...manifest, goals: manifest.goals.map(({ bundle: _b, artifacts: _a, remoteUrl: _r, ...g }: Record<string, unknown>) => g) }));
    await packTransfer(x, join(tmp, 'older.tgz'));
    const r = await receiveTransfer(b, join(tmp, 'older.tgz'));
    expect(r.goals.every((g) => g.bundle === false && g.remoteUrl === null)).toBe(true);
    await expect(inspectIncoming(b, 'in_gone')).rejects.toThrow('upload is gone');
  });
});

test('remotes and releases compare the way a person reads them', async () => {
  expect(sameRemote('git@github.com:Acme/App.git', 'https://github.com/acme/app')).toBe(true);
  expect(sameRemote('ssh://git@github.com/acme/app.git', 'https://github.com/acme/app/')).toBe(true);
  expect(sameRemote('https://github.com/acme/app', 'https://github.com/acme/other')).toBe(false);
  expect([newerRelease('1.2.0', '1.1.9'), newerRelease('1.1.3', '1.1.3'), newerRelease('2.0.0-beta', '1.0.0')]).toEqual([true, false, false]);
  await sh('git remote add origin git@github.com:acme/app.git', repo);
  expect(await matchRepo(repo, 'https://github.com/acme/app')).toBe(repo);
  expect(await matchRepo(repo, 'https://github.com/acme/other')).toBeNull();
  expect(await matchRepo(repo, null)).toBeNull();
  expect(await matchRepo(join(repo, 'nope'), null)).toBeNull();
});
