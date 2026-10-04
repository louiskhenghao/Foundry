import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, Goal, listGoals } from '@foundry/core';
import { Engine } from './engine.ts';
import { defaultConfig } from './config.ts';
import { FakeRunner, makeRepo } from './test-helpers.ts';
import { modelFor } from './models/roles.ts';
import { formatWorkflowObservation } from './checks/reviewer.ts';
import { ProviderRunner } from './provider-runner.ts';
import { createApp } from '../../server/src/app.ts';
import { CodexQuotaReader } from './usage/codex-quota.ts';
import { parseCodexUsage } from './usage/codex-usage.ts';

const dirs: string[] = [];
const engines: Engine[] = [];
afterEach(async () => { for (const e of engines.splice(0)) await e.stop(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function setup() {
  const repo = await makeRepo(); dirs.push(repo);
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-providers-')); dirs.push(dataDir);
  const claude = new FakeRunner(() => {}), codex = new FakeRunner(() => {});
  const config = defaultConfig(resolve(import.meta.dir, '../../..'), { provider: 'claude', dataDir, codexHome: join(dataDir, 'codex'), log: () => {}, useGraphify: false });
  const engine = new Engine(config, { claude, codex }); engines.push(engine);
  return { engine, repo, claude, codex, config };
}
async function drain(handle: Awaited<ReturnType<FakeRunner['run']>>) { for await (const _ of handle.events) {} return handle.result; }

test('a single store routes both providers, pins models and resumes only through the owning runner', async () => {
  const { engine, repo, claude, codex, config } = await setup();
  const a = await engine.createGoal({ prompt: 'Claude task', repoPath: repo, provider: 'claude' });
  const b = await engine.createGoal({ prompt: 'Codex task', repoPath: repo, provider: 'codex', codexModel: 'gpt-pinned', budgets: { maxCostUsd: 3 } });
  expect(b.budgets.maxCostUsd).toBeNull();
  expect(modelFor(config, b, 'taskReviewer').model).toBe('gpt-pinned');
  expect(modelFor({ ...config, provider: 'codex' }, a, 'clarifier').model).not.toBe('gpt-pinned');
  for (const goal of [a, b]) {
    const result = await drain(await engine.runner.run({ prompt: 'test', cwd: repo, model: goal.models.cheap, meta: { goalId: goal.id }, resumeSessionId: `${goal.provider}-session` }));
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'work', model: goal.models.cheap });
  }
  expect(claude.calls.map((c) => c.resumeSessionId)).toEqual(['claude-session']);
  expect(codex.calls.map((c) => c.resumeSessionId)).toEqual(['codex-session']);
  engine.updateSettings({ models: { codexModel: 'gpt-next', cheap: 'changed-housekeeping' } });
  expect(getGoal(engine.store.db, b.id)?.models.worker).toBe('gpt-pinned');
  expect(engine.usage('claude').fiveHour.sessions).toBe(1);
  expect(engine.usage('codex').fiveHour.sessions).toBe(1);
  expect(engine.usage('codex').costAvailable).toBe(false);
  engine.store.replay();
  expect(listGoals(engine.store.db).map((g) => g.provider).sort()).toEqual(['claude', 'codex']);
  expect(engine.usage('codex').fiveHour.sessions).toBe(1);
});

test('legacy provider assignment is replayable and cannot switch an existing goal', async () => {
  const { engine, repo } = await setup();
  const goal = await engine.createGoal({ prompt: 'legacy', repoPath: repo });
  const old = Goal.parse({ ...goal, id: 'legacy-fixture', provider: undefined });
  engine.store.append({ type: 'goal.created', goalId: old.id, payload: { goal: old } });
  engine.store.append({ type: 'goal.provider_assigned', goalId: old.id, payload: { provider: 'codex' } });
  engine.store.append({ type: 'goal.provider_assigned', goalId: old.id, payload: { provider: 'claude' } });
  engine.store.replay();
  expect(getGoal(engine.store.db, old.id)?.provider).toBe('codex');
  expect(getGoal(engine.store.db, old.id)?.budgets.maxCostUsd).toBeNull();
});

test('rate limits are scoped to one provider', async () => {
  const { engine } = await setup();
  engine.pauseUntil(Date.now() + 60_000, null, 'test', 'codex');
  expect(engine.isRateLimited('codex')).toBe(true);
  expect(engine.isRateLimited('claude')).toBe(false);
  expect(engine.usage('claude').pausedUntil).toBeNull();
  expect(engine.usage('codex').pausedUntil).not.toBeNull();
});

test('account API isolates status and rejects unknown providers', async () => {
  const { engine } = await setup();
  const checked: string[] = [];
  for (const provider of ['claude', 'codex'] as const) engine.accounts[provider].status = async () => { checked.push(provider); return { provider, loggedIn: true, authMethod: provider, apiProvider: null, email: null, orgName: null, subscriptionType: null, checkedAt: '', error: null }; };
  const app = createApp(engine);
  const response = await app.request('/api/accounts');
  const body = await response.json() as any;
  expect(body.accounts.map((a: any) => a.provider)).toEqual(['claude', 'codex']);
  checked.length = 0;
  expect((await (await app.request('/api/auth?provider=codex')).json() as any).provider).toBe('codex');
  expect(checked).toEqual(['codex']);
  expect((await app.request('/api/auth?provider=unknown')).status).toBe(400);
});

test('unobservable skills are not reported as skipped', () => {
  const text = formatWorkflowObservation({ mandated: [{ name: 'tdd', invoke: '/tdd' }], used: [], observable: false });
  expect(text).toContain('telemetry is unavailable');
  expect(text).not.toContain('NOT invoked');
});

test('global concurrency limits both providers and releases completed slots', async () => {
  let release!: () => void;
  const first = new FakeRunner(() => new Promise<void>((resolve) => { release = resolve; }));
  const second = new FakeRunner(() => {});
  const router = new ProviderRunner({ claude: first, codex: second }, (spec) => spec.meta?.provider as 'claude' | 'codex', 1);
  const pending = router.run({ prompt: 'a', cwd: '/tmp', meta: { provider: 'claude' } });
  await Bun.sleep(5);
  const queued = router.run({ prompt: 'b', cwd: '/tmp', meta: { provider: 'codex' } });
  expect(second.calls).toHaveLength(0);
  release(); await drain(await pending); await drain(await queued);
  expect(second.calls).toHaveLength(1);
  expect(router.active()).toBe(0);
});


test('usage refreshes use native Codex quota reads while inference probes stay scoped to Claude', async () => {
  const { engine, claude, codex } = await setup();
  engine.config.provider = 'codex';
  const nativeReads: { bin: string; home: string | undefined; aborted: boolean | undefined }[] = [];
  Object.defineProperty(engine, 'codexQuota', { value: new CodexQuotaReader({
    bin: () => 'codex-fixture', home: engine.config.codexHome,
    read: async (bin, home, options) => {
      nativeReads.push({ bin, home, aborted: options?.signal?.aborted });
      return parseCodexUsage({ ordinaryUsageAllowed: false, rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1 } } });
    },
  }) });
  const app = createApp(engine);
  expect((await app.request('/api/usage?provider=codex')).status).toBe(200);
  expect(nativeReads).toHaveLength(1);
  const refreshed = await app.request('/api/usage/probe?provider=codex', { method: 'POST' });
  expect(refreshed.status).toBe(200);
  expect(nativeReads).toEqual(Array(2).fill({ bin: 'codex-fixture', home: engine.config.codexHome, aborted: false }));
  expect(await refreshed.json()).toMatchObject({ provider: 'codex', costAvailable: false, codexQuota: { state: 'available', ordinaryUsageAllowed: false, buckets: [{ id: 'codex', primary: { usedPercent: 25 } }] } });
  expect(claude.calls).toHaveLength(0);
  expect(codex.calls).toHaveLength(0);
  expect(engine.usage('codex').fiveHour.sessions).toBe(0);
  const result = await app.request('/api/usage/probe?provider=claude', { method: 'POST' });
  expect(result.status).toBe(200);
  expect(claude.calls).toHaveLength(1);
  expect(codex.calls).toHaveLength(0);
  expect((await result.json() as any).provider).toBe('claude');
  expect(engine.usage('claude').fiveHour.sessions).toBe(1);
  expect(nativeReads).toHaveLength(2);
});

test('a failed provider startup releases the shared concurrency slot', async () => {
  const failed = new FakeRunner(() => {});
  failed.run = async () => { throw new Error('CLI unavailable'); };
  const healthy = new FakeRunner(() => {});
  const router = new ProviderRunner({ claude: failed, codex: healthy }, (spec) => spec.meta?.provider as 'claude' | 'codex', 1);
  await expect(router.run({ prompt: 'fail', cwd: '/tmp', meta: { provider: 'claude' } })).rejects.toThrow('CLI unavailable');
  await drain(await router.run({ prompt: 'ok', cwd: '/tmp', meta: { provider: 'codex' } }));
  expect(router.active()).toBe(0);
});


test('model probes and registries stay isolated with a Codex launch default', async () => {
  const { engine, claude, codex } = await setup();
  engine.config.provider = 'codex';
  const app = createApp(engine);
  const result = await app.request('/api/models/probe?provider=claude', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'claude-fixture' }) });
  expect(result.status).toBe(200);
  expect(claude.calls).toHaveLength(1);
  expect(codex.calls).toHaveLength(0);
  expect(engine.providerModels.claude.get('claude-fixture')).not.toBeNull();
  expect(engine.providerModels.codex.get('claude-fixture')).toBeNull();
  expect(engine.usage('claude').fiveHour.sessions).toBe(1);
});
