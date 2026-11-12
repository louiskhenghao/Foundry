import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from '../test-helpers.ts';
import { FOUNDRY_ENV_FILE, FOUNDRY_ENV_OVERRIDE, allDeployEnv, copyPreviewEnv, deployEnvKey, deployEnvStore, deployEnvView, dotenvText, importCheckoutDeployEnv, setDeployEnv, splitDeployEnvKey, writeServerEnv } from './env.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-deploy-env-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});
async function finishedGoal(files: Record<string, string>) {
  for (const [p, body] of Object.entries(files)) writeFileSync(join(repo, p), body);
  await sh('git add -A && git -c user.name=t -c user.email=t@t commit -q -m site', repo);
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), new FakeRunner(() => {}));
  engines.push(engine);
  const goal = await engine.createGoal({ prompt: 'a service', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
  return { engine, goal: getGoal(engine.store.db, goal.id)! };
}

describe('the runtime variables of a deploy (ADR-0095)', () => {
  test('a dotenv text quotes every value for a shell and for compose alike; the env file is owner-only; the override hands it to every service', () => {
    expect(dotenvText({ DATABASE_URL: 'postgres://u:p@db/app', TOKEN: "it's", EMPTY: '', 'bad-name': 'x' })).toBe("DATABASE_URL='postgres://u:p@db/app'\nTOKEN='it'\\''s'\nEMPTY=''\n");
    const dir = mkdtempSync(join(tmpdir(), 'foundry-env-write-'));
    expect(writeServerEnv(dir, { A: '1' }, ['web', 'worker'])).toBe(FOUNDRY_ENV_OVERRIDE);
    expect(statSync(join(dir, FOUNDRY_ENV_FILE)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, FOUNDRY_ENV_OVERRIDE), 'utf8')).toBe(`# written by Foundry (Deploy): the runtime variables kept for this place reach every service of the project\nservices:\n  web:\n    env_file:\n      - ${FOUNDRY_ENV_FILE}\n  worker:\n    env_file:\n      - ${FOUNDRY_ENV_FILE}\n`);
    // a PM2 project gets the file alone
    expect(writeServerEnv(dir, { A: '1' }, null)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
    expect(splitDeployEnvKey(deployEnvKey('/r/one', 'server:s1'))).toEqual({ repoPath: '/r/one', place: 'server:s1' });
  });

  test('a place’s set for a repository: the example files’ keys without a value, the previews’ keys it lacks, copied or imported on request, kept per place', async () => {
    const { engine, goal } = await finishedGoal({ '.env.example': '# where the data lives\nDATABASE_URL=postgres://localhost/app\nSESSION_SECRET=\nOPTIONAL_FLAG=1\n', 'server.js': '' });
    writeFileSync(join(repo, '.env'), 'DATABASE_URL=postgres://real/app\nLOCAL_ONLY=1\n');
    engine.preview.env.set(repo, { SESSION_SECRET: 'from-preview-0123', PREVIEW_ONLY: 'p' }, 0);
    const v0 = deployEnvView(engine, goal, 'server:s1');
    expect(v0).toMatchObject({ place: 'server:s1', rev: 0, keys: [], missing: ['SESSION_SECRET', 'DATABASE_URL', 'OPTIONAL_FLAG'], fromPreview: ['PREVIEW_ONLY', 'SESSION_SECRET'] });
    expect(v0.notes.DATABASE_URL).toMatchObject({ comment: 'where the data lives', example: 'postgres://localhost/app', file: '.env.example' });
    expect(v0.checkout.keys).toEqual(['DATABASE_URL', 'LOCAL_ONLY']);
    const v1 = setDeployEnv(engine, goal, 'server:s1', { DATABASE_URL: 'postgres://db/app' }, 0);
    expect(v1).toMatchObject({ rev: 1, keys: ['DATABASE_URL'], missing: ['SESSION_SECRET', 'OPTIONAL_FLAG'] });
    // null keeps a saved value; a save from an old revision is refused
    expect(setDeployEnv(engine, goal, 'server:s1', { DATABASE_URL: null, TOKEN: 'abcdefgh' }, 1).keys).toEqual(['DATABASE_URL', 'TOKEN']);
    expect(() => setDeployEnv(engine, goal, 'server:s1', { DATABASE_URL: null }, 1)).toThrow(/changed elsewhere/);
    expect(deployEnvStore(engine).get(deployEnvKey(repo, 'server:s1')).vars).toEqual({ DATABASE_URL: 'postgres://db/app', TOKEN: 'abcdefgh' });
    const copied = copyPreviewEnv(engine, goal, 'server:s1');
    expect(copied.added.sort()).toEqual(['PREVIEW_ONLY', 'SESSION_SECRET']);
    expect(copied.view.fromPreview).toEqual([]);
    const imported = importCheckoutDeployEnv(engine, goal, 'server:s1');
    expect(imported.added).toEqual(['LOCAL_ONLY']);
    expect(deployEnvStore(engine).get(deployEnvKey(repo, 'server:s1')).vars.DATABASE_URL).toBe('postgres://db/app');
    // another place of the same repository starts empty; a Transfer sees repo → place → vars
    expect(deployEnvView(engine, goal, 'fly').keys).toEqual([]);
    setDeployEnv(engine, goal, 'fly', { FLY_ONLY: 'x' }, 0);
    expect(allDeployEnv(engine)).toEqual({ [repo]: { 'server:s1': { DATABASE_URL: 'postgres://db/app', TOKEN: 'abcdefgh', SESSION_SECRET: 'from-preview-0123', PREVIEW_ONLY: 'p', LOCAL_ONLY: '1' }, fly: { FLY_ONLY: 'x' } } });
    expect(statSync(join(dataDir, 'deploy-env.json')).mode & 0o777).toBe(0o600);
    mkdirSync(join(dataDir, 'x'), { recursive: true });
  }, 30_000);
});
