import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SealedSecrets, TransferManifest, getGoal, listAttemptsByGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, waitFor } from '../test-helpers.ts';
import { unpackTransfer } from './archive.ts';
import { engineTransferHost, exportTransfer } from './export.ts';
import { openSecrets } from './secrets.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let out: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-export-'));
  out = mkdtempSync(join(tmpdir(), 'foundry-export-out-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [dataDir, out, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

/** a finished goal whose work is only on its local branch, and a draft that never started */
async function twoGoals() {
  const runner = new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'));
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), alwaysReviewTasks: false, log: () => {} }), runner);
  engines.push(engine);
  const done = await engine.createGoal({ prompt: 'create done.txt', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
  await waitFor(() => ['done', 'over_delivered'].includes(getGoal(engine.store.db, done.id)!.state), 30_000);
  engine.beginUpdateDrain(); // the draft stays a draft
  const draft = await engine.createGoal({ prompt: 'a later idea', repoPath: repo });
  return { engine, done: getGoal(engine.store.db, done.id)!, draft: getGoal(engine.store.db, draft.id)! };
}

test('a Transfer file carries the ticked categories, each goal\'s events and its unmerged branch, and changes nothing here', async () => {
  const { engine, done, draft } = await twoGoals();
  engine.updateSettings({ models: { cheap: 'sonnet' }, engine: { maxConcurrent: 5 }, tools: { openaiApiKey: 'sk-live-0123456789' } });
  engine.preview.env.set(repo, { DATABASE_URL: 'postgres://local' }, 0);
  const before = engine.store.count();

  const file = join(out, 'f.tgz');
  const res = await exportTransfer(engineTransferHost(engine), { categories: { settings: true, secrets: true, goals: true, transcripts: true }, goalIds: 'all', password: 'pw', out: file });
  expect(engine.store.count()).toBe(before);
  expect(res.bytes).toBeGreaterThan(0);

  const x = join(out, 'x');
  await unpackTransfer(file, x);
  const manifest = TransferManifest.parse(JSON.parse(readFileSync(join(x, 'manifest.json'), 'utf8')));
  expect(manifest.goals.map((g) => [g.id, g.unfinished, g.bundle])).toEqual([[done.id, false, true], [draft.id, true, false]]);
  expect(manifest.source.dataDir).toBe(dataDir);
  const lines = readFileSync(join(x, 'goals', done.id, 'events.jsonl'), 'utf8').trim().split('\n');
  expect(lines.length).toBe(engine.store.listByGoal(done.id, -1).length);
  expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'goal.created', goalId: done.id });
  // the bundle restores the goal branch with its work
  const clone = join(out, 'clone');
  await sh(`git clone -q ${repo} ${clone} && git -C ${clone} fetch -q ${join(x, 'goals', done.id, 'branch.bundle')} ${done.branch}:${done.branch} && git -C ${clone} show ${done.branch}:done.txt`, out);
  // Settings without what belongs to this computer, and no credential in the clear
  expect(JSON.parse(readFileSync(join(x, 'settings.json'), 'utf8'))).toEqual({ models: { cheap: 'sonnet' } });
  expect(readFileSync(join(x, 'secrets.json'), 'utf8')).not.toContain('sk-live');
  const secrets = openSecrets(SealedSecrets.parse(JSON.parse(readFileSync(join(x, 'secrets.json'), 'utf8'))), 'pw', manifest.transferId);
  expect(secrets).toEqual({ settings: { 'tools.openaiApiKey': 'sk-live-0123456789' }, previewEnv: { [repo]: { DATABASE_URL: 'postgres://local' } } });
  // the attempt's session files came along (the fake runner writes only the prompt half)
  const attempt = listAttemptsByGoal(engine.store.db, done.id)[0]!;
  expect(readdirSync(join(x, 'transcripts'))).toContain(`${attempt.id}.prompt.md`);
});

test('goals can be picked one by one; Keys & secrets refuse to travel without a password', async () => {
  const { engine, draft } = await twoGoals();
  const host = engineTransferHost(engine);
  const file = join(out, 'one.tgz');
  const res = await exportTransfer(host, { categories: { goals: true }, goalIds: [draft.id], out: file });
  expect(res.manifest.goals.map((g) => g.id)).toEqual([draft.id]);
  const x = join(out, 'x');
  await unpackTransfer(file, x);
  expect(existsSync(join(x, 'settings.json')) || existsSync(join(x, 'secrets.json')) || existsSync(join(x, 'transcripts'))).toBe(false);
  await expect(exportTransfer(host, { categories: { secrets: true }, out: file })).rejects.toThrow('need a password');
  await expect(exportTransfer(host, { categories: { transcripts: true }, out: file })).rejects.toThrow('tick at least one');
  await expect(exportTransfer(host, { categories: { goals: true }, goalIds: ['g_nope'], out: file })).rejects.toThrow('not found');
});
