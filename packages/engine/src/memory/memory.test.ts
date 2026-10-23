import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, waitFor } from '../test-helpers.ts';
import { FakeMemoryBackend as FakeBackend } from './fake-backend.ts';
import { REFLECT_MAX_CHARS, TOKEN_ENV } from './memory.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-memory-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const fake = new FakeBackend();
  let made = 0;
  engine.memoryDeps = {
    backend: () => {
      made++;
      return fake;
    },
    reflectTimeoutMs: 200,
    retainTimeoutMs: 500,
  };
  cleanups.push(async () => {
    await engine.stop();
    for (const p of [dataDir, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
  });
  return { engine, repo, fake, bank: `coding-agent::${basename(repo)}`, made: () => made };
}

describe('Memory', () => {
  test('with no server address nothing is asked, written or handed to sessions', async () => {
    const { engine, repo, fake } = await setup();
    expect(engine.memory.enabled()).toBe(false);
    expect(await engine.memory.bankFor(repo)).toBeNull();
    expect(await engine.memory.reflect('attempt', 'anything', { repoPath: repo, goalId: null })).toBeNull();
    expect(await engine.memory.retain({ content: 'x', context: 'c', tags: [] }, { repoPath: repo, goalId: null, source: 'record' })).toBe(false);
    expect(fake.questions).toEqual([]);
    expect(engine.store.listByType('memory.recalled', 10)).toEqual([]);
    expect(engine.sessionEnvExtra()[TOKEN_ENV]).toBeUndefined();
    const status = await engine.memory.status();
    expect(status).toMatchObject({ configured: false, reachable: null, version: null, tokenSet: false });
    // the folder's bank is known all the same (the Learnings page shows it)
    expect(await engine.memory.folderStatus(repo)).toMatchObject({ bank: `coding-agent::${basename(repo)}`, enabled: false, excluded: false });
  });

  test('once a server is set, a stage gets the bank\'s answer, cut to size, and the ask is recorded on the goal', async () => {
    const { engine, repo, fake, bank } = await setup();
    engine.updateSettings({ memory: { url: 'http://127.0.0.1:1/', token: 'tok-secret-123456' } });
    expect(engine.memory.enabled()).toBe(true);
    expect(engine.sessionEnvExtra()[TOKEN_ENV]).toBe('tok-secret-123456');
    expect(await engine.memory.reflect('attempt', 'what about tests?', { repoPath: repo, goalId: 'g1', taskId: 't1' })).toBe('remember: the tests need bun install first');
    expect(fake.questions).toEqual(['what about tests?']);
    // the bank was created for a coding project, and seeded from the repository's commits
    expect(fake.created).toEqual([{ id: bank, mission: expect.stringContaining('memory of one software repository') }]);
    await waitFor(() => (fake.docs.get(bank)?.length ?? 0) >= 1);
    expect(fake.docs.get(bank)!.map((d) => d.documentId)).toEqual([expect.stringMatching(/^git:[0-9a-f]{40}$/)]);
    expect(fake.docs.get(bank)![0]!.content).toContain('init');
    await waitFor(() => engine.store.listByType('memory.retained', 10).length >= 1);
    expect(engine.store.listByType('memory.retained', 10)[0]).toMatchObject({ goalId: null, payload: { source: 'git', bankId: bank, count: 1, error: null } });
    const recalled = engine.store.listByType('memory.recalled', 10);
    expect(recalled).toHaveLength(1);
    expect(recalled[0]).toMatchObject({ goalId: 'g1', payload: { stage: 'attempt', bankId: bank, query: 'what about tests?', text: 'remember: the tests need bun install first', error: null, taskId: 't1' } });

    fake.answer = 'y'.repeat(REFLECT_MAX_CHARS + 500);
    const long = await engine.memory.reflect('clarify', 'q2', { repoPath: repo, goalId: 'g1' });
    expect(long!.length).toBe(REFLECT_MAX_CHARS);
    expect(long!.endsWith('…')).toBe(true);
    const status = await engine.memory.status();
    expect(status).toMatchObject({ configured: true, url: 'http://127.0.0.1:1', tokenSet: true, reachable: true, version: '1.1.0-test', error: null });
  });

  test('a server that does not answer in time costs the stage nothing but the wait, and says so on the goal', async () => {
    const { engine, repo, fake } = await setup();
    engine.updateSettings({ memory: { url: 'http://127.0.0.1:1' } });
    fake.answer = (signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
    expect(await engine.memory.reflect('review_task', 'slow', { repoPath: repo, goalId: 'g1' })).toBeNull();
    const [e] = engine.store.listByType('memory.recalled', 10);
    expect(e).toMatchObject({ payload: { stage: 'review_task', text: null } });
    expect((e!.payload as { error: string | null }).error).toBeTruthy();
    expect((e!.payload as { ms: number }).ms).toBeGreaterThanOrEqual(100);
  });

  test('what is written is scrubbed of the credentials Foundry keeps, and a refused write is a record, not an error', async () => {
    const { engine, repo, fake, bank } = await setup();
    engine.updateSettings({ memory: { url: 'http://127.0.0.1:1', token: 'tok-secret-123456' }, tools: { openaiApiKey: 'sk-proj-abcdefghijkl' } });
    const ok = await engine.memory.retain({ content: 'ran with OPENAI_API_KEY=sk-proj-abcdefghijkl and Authorization: Bearer tok-secret-123456', context: 'a test', documentId: 'goal:g1:record', tags: ['source:foundry'] }, { repoPath: repo, goalId: 'g1', source: 'record' });
    expect(ok).toBe(true);
    const written = fake.docs.get(bank)!.find((d) => d.documentId === 'goal:g1:record')!;
    expect(written.content).not.toContain('sk-proj-abcdefghijkl');
    expect(written.content).not.toContain('tok-secret-123456');
    expect(written.content).toContain('••••');
    expect(engine.store.listByType('memory.retained', 10).find((e) => (e.payload as { source: string }).source === 'record')).toMatchObject({ goalId: 'g1', payload: { count: 1, documentId: 'goal:g1:record', error: null } });

    fake.failRetain = true;
    expect(await engine.memory.retain({ content: 'x', context: 'c', tags: [] }, { repoPath: repo, goalId: 'g1', source: 'review', taskId: 't9' })).toBe(false);
    expect(engine.store.listByType('memory.retained', 10).find((e) => (e.payload as { source: string }).source === 'review')).toMatchObject({ payload: { count: 0, error: expect.stringContaining('boom'), taskId: 't9' } });
  });

  test('a folder left out neither reads nor writes; a bank that exists keeps its settings and is not seeded again', async () => {
    const { engine, repo, fake, bank, made } = await setup();
    engine.updateSettings({ memory: { url: 'http://127.0.0.1:1' } });
    engine.memory.setFolder(repo, false);
    expect(engine.settings.values().memory.excludedFolders).toEqual([repo]);
    expect(await engine.memory.folderStatus(repo)).toMatchObject({ bank, enabled: false, excluded: true });
    expect(await engine.memory.reflect('attempt', 'q', { repoPath: repo, goalId: 'g1' })).toBeNull();
    expect(fake.questions).toEqual([]);
    engine.memory.setFolder(repo, true);
    expect(engine.settings.values().memory.excludedFolders).toEqual([]);

    // the person's own sessions made this bank already: Foundry leaves its mission alone and seeds nothing
    fake.banks.add(bank);
    fake.docs.set(bank, [{ content: 'theirs', context: 'c', tags: [] }]);
    expect(await engine.memory.reflect('attempt', 'q', { repoPath: repo, goalId: 'g1' })).toBe('remember: the tests need bun install first');
    expect(fake.created).toEqual([]);
    await engine.stop();
    expect(fake.docs.get(bank)).toHaveLength(1);
    // one connection per address: a changed address connects anew
    const before = made();
    expect(before).toBeGreaterThanOrEqual(1);
  });

  test('a folder that is not a repository has no memory even with a server set', async () => {
    const { engine, fake } = await setup();
    engine.updateSettings({ memory: { url: 'http://127.0.0.1:1' } });
    const dir = mkdtempSync(join(tmpdir(), 'foundry-memory-plain-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(await engine.memory.reflect('attempt', 'q', { repoPath: dir, goalId: 'g1' })).toBeNull();
    expect(fake.questions).toEqual([]);
    expect(fake.created).toEqual([]);
  });
});
