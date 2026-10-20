import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Goal, listGoals, upsertGoal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo, makeRepoWithRemote, sh } from '../../packages/engine/src/test-helpers.ts';
import { createApp } from '../../packages/server/src/app.ts';

for (const key of Object.keys(process.env)) if (key.startsWith('FOUNDRY_')) delete process.env[key];

const root = resolve(import.meta.dir, '../..');
const vitePackage = createRequire(join(root, 'apps/web/package.json')).resolve('vite/package.json');
const { createServer } = await import(new URL('./dist/node/index.js', pathToFileURL(vitePackage)).href);
const home = mkdtempSync(join(tmpdir(), 'foundry-workflow-e2e-'));
process.env.GIT_CONFIG_GLOBAL = join(home, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\nname = Workflow fixture\nemail = fixture@example.test\n');
const { repo, bare } = await makeRepoWithRemote();
const initialHead = await sh('git rev-parse HEAD', repo);
const empty = await makeRepo();
const invalid = join(home, 'not-a-repository');
mkdirSync(invalid);
const native = join(home, 'native-cli');
writeFileSync(native, `#!${process.execPath}
import { createInterface } from 'node:readline';
if (process.argv.includes('app-server')) {
  createInterface({ input: process.stdin }).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.id == null) return;
    const result = msg.method === 'account/read' ? { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'pro' } } : { data: [], nextCursor: null };
    console.log(JSON.stringify({ id: msg.id, result }));
  });
} else if (process.argv.includes('status')) console.log(JSON.stringify({ loggedIn: true, authMethod: 'claudeai' }));
else console.log('[]');
`);
chmodSync(native, 0o755);
const engine = new Engine(defaultConfig(root, {
  provider: 'claude', dataDir: join(home, 'data'), claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'),
  claudeBin: native, codexBin: native, autoskills: false, useGraphify: false, log: () => {},
}), new FakeRunner(() => {}));
engine.beginUpdateDrain();
engine.updateSettings({ engine: { provider: 'claude' }, workflow: { defaultMode: 'expert', defaultPace: 'thorough', profile: 'mattpocock', tdd: 'required', ponytail: 'on' } });
const codexSkills = engine.skillsForProvider('codex');
codexSkills.paths.agentsSkillsDir = join(home, 'agents', 'skills');
codexSkills.paths.agentsLock = join(home, 'agents', '.skill-lock.json');

function seed(id: string, title: string, createdAt: string, workflow: Goal['workflow'], repoPath = repo) {
  const goal = Goal.parse({
    id, title, prompt: title, repoPath, baseBranch: 'main', branch: `goal/${id}`,
    budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'cancelled', stateBeforeBlock: null,
    costUsd: 0, fixCycles: 0, runningSince: null, createdAt, updatedAt: createdAt, workflow,
  });
  upsertGoal(engine.store.db, goal);
}
seed('g_older', 'Earlier Follow-up', '2026-01-01T00:00:00Z', { profile: 'plain', tdd: 'preferred', pace: 'thorough', ponytail: 'on' });
seed('g_latest', 'Latest <folder> goal', '2026-02-01T00:00:00Z', { profile: 'pstack', tdd: 'off', pace: 'thorough', ponytail: 'off' });
seed('g_initializable', 'Before git initialization', '2026-03-01T00:00:00Z', { profile: 'plain', tdd: 'preferred', pace: 'thorough', ponytail: 'off' }, invalid);

const app = createApp(engine);
app.post('/api/__fixture/reset', async (c) => {
  for (const goal of listGoals(engine.store.db)) {
    if (goal.id !== 'g_older' && goal.id !== 'g_latest' && goal.id !== 'g_initializable') await engine.deleteGoal(goal.id);
  }
  rmSync(invalid, { recursive: true, force: true });
  mkdirSync(invalid);
  await Bun.$`git reset -q --hard ${initialHead}`.cwd(repo).quiet();
  await Bun.$`git --git-dir ${bare} update-ref refs/heads/main ${initialHead}`.quiet();
  return c.json({ ok: true });
});
app.get('/api/__fixture', (c) => c.json({ repo, empty, invalid, older: 'g_older' }));
app.post('/api/__fixture/newer', async (c) => {
  seed('g_newer', 'Refreshed folder goal', '2099-01-01T00:00:00Z', { profile: 'plain', tdd: 'preferred', pace: 'thorough', ponytail: 'on' });
  await sh('git -c user.name=fixture -c user.email=fixture@example.test commit --allow-empty -qm newer && git push -q origin main && git reset -q --hard HEAD~1', repo);
  return c.json({ ok: true });
});
const backend = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.API_PORT ?? 4312), fetch: app.fetch });
const target = `http://127.0.0.1:${backend.port}`;
const web = await createServer({
  root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 4311), strictPort: true, proxy: { '/api': target, '/ws': { target: target.replace('http', 'ws'), ws: true } } },
});
await web.listen();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await web.close();
  backend.stop(true);
  await engine.stop();
  for (const path of [home, repo, bare, bare.slice(0, -4), empty, `${repo}-foundry`, `${empty}-foundry`]) rmSync(path, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
