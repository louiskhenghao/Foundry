import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, waitFor } from '../test-helpers.ts';
import { bundledRecipesDir, listRecipes, parseRecipe, recipeRuns, startRecipe } from './recipes.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
const engines: Engine[] = [];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-recipes-'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
});
function engine() {
  const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
  engines.push(e);
  return e;
}
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEKEYLINE0123456789abcdefghijklmnop\n-----END OPENSSH PRIVATE KEY-----';

/**
 * A stand-in for ssh (ADR-0091): the remote command is logged, the script on stdin is kept whole, `sudo -n true` answers
 * as a user with (or, with NOSUDO in its folder, without) passwordless sudo, and the script "runs" by echoing a line
 * and, with FAIL in its folder, failing.
 */
function fakeSsh(dir: string): string {
  const path = join(dir, 'fake-ssh');
  writeFileSync(
    path,
    `#!/bin/sh
while [ $# -gt 0 ]; do case "$1" in -i|-p|-o) shift 2 ;; *) break ;; esac; done
dest="$1"; shift; cmd="$*"
printf 'ssh|%s|%s\\n' "$dest" "$cmd" >> "${join(dir, 'ssh.log')}"
case "$cmd" in
  "sudo -n true") if [ -f "${join(dir, 'NOSUDO')}" ]; then echo "sudo: a password is required" >&2; exit 1; fi; exit 0 ;;
  *'bash -c "$(cat)"'*) cat > "${join(dir, 'script.sh')}"; echo "ran as $(echo "$cmd" | cut -d' ' -f1)"; if [ -f "${join(dir, 'FAIL')}" ]; then echo "E: Unable to locate package nope" >&2; exit 100; fi; echo "Docker is ready. token=$SECRET_SHOULD_NOT_LEAK" ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe('server recipes (ADR-0091): the scripts and their headers', () => {
  test('every bundled recipe parses: an id, a title, what it changes, its inputs; secrets marked; the item it fixes', () => {
    const dir = bundledRecipesDir({ config: { rootDir: ROOT } } as never);
    const recipes = readdirSync(dir)
      .filter((f) => f.endsWith('.sh'))
      .map((f) => parseRecipe(join(dir, f), readFileSync(join(dir, f), 'utf8'), 'bundled'));
    expect(recipes.map((r) => r.id).sort()).toEqual(['install-docker', 'install-node-pm2', 'install-postgres', 'install-redis', 'nginx-site']);
    for (const r of recipes) {
      expect(r.title.length).toBeGreaterThan(8);
      expect(r.changes.length).toBeGreaterThan(0);
      expect(r.root).toBe(true);
      expect(r.text).toContain('set -euo pipefail');
    }
    const nginx = recipes.find((r) => r.id === 'nginx-site')!;
    expect(nginx.fixes).toBe('front');
    expect(nginx.params.map((p) => [p.name, p.secret, p.default])).toEqual([
      ['DOMAIN', false, null],
      ['APP_PORT', false, '3000'],
      ['SITE_NAME', false, 'app'],
      ['SSL_MODE', false, 'letsencrypt'],
      ['CERT_PEM', true, null],
      ['KEY_PEM', true, null],
      ['LETSENCRYPT_EMAIL', false, null],
    ]);
    expect(recipes.find((r) => r.id === 'install-docker')!.fixes).toBe('docker');
    expect(recipes.find((r) => r.id === 'install-node-pm2')!.fixes).toBe('runtime');
    expect(recipes.find((r) => r.id === 'install-postgres')!.params.find((p) => p.name === 'POSTGRES_APP_PASSWORD')!.secret).toBe(true);
  });

  test('the person’s own scripts under data/server-recipes are recipes too, named after their file when they say nothing of themselves', () => {
    const e = engine();
    mkdirSync(join(dataDir, 'server-recipes'), { recursive: true });
    writeFileSync(join(dataDir, 'server-recipes', 'setup.sh'), '#!/bin/bash\nset -euo pipefail\necho hi\n');
    writeFileSync(join(dataDir, 'server-recipes', 'tuned.sh'), '#!/bin/bash\n# foundry-recipe: tuned\n# title: My tuned setup\n# changes: installs htop\n# param: COLOUR | A colour | blue\nset -e\n');
    writeFileSync(join(dataDir, 'server-recipes', 'notes.txt'), 'not a script');
    const all = listRecipes(e);
    expect(all.filter((r) => r.source === 'bundled')).toHaveLength(5);
    expect(all.filter((r) => r.source === 'own').map((r) => [r.id, r.title, r.changes, r.params.length])).toEqual([
      ['own:setup', 'setup.sh', [], 0],
      ['own:tuned', 'My tuned setup', ['installs htop'], 1],
    ]);
  });
});

describe('running a recipe on a server', () => {
  async function ready(user = 'deploy') {
    const e = engine();
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-recipes-ssh-'));
    e.deploySsh = [fakeSsh(fakes)];
    e.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user, privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' }] } });
    const log = () => (existsSync(join(fakes, 'ssh.log')) ? readFileSync(join(fakes, 'ssh.log'), 'utf8').trim().split('\n') : []);
    return { e, fakes, log };
  }

  test('the script goes over ssh on stdin with its inputs as environment lines, runs as root through sudo, and its output is recorded with the secrets blanked', async () => {
    const { e, fakes, log } = await ready();
    expect(() => startRecipe(e, 'srv1', 'nope', {})).toThrow(/no recipe named nope/);
    expect(() => startRecipe(e, 'other', 'install-docker', {})).toThrow(/not in Settings/);
    startRecipe(e, 'srv1', 'install-postgres', { POSTGRES_APP_PASSWORD: 'hunter2-secret', POSTGRES_APP_DB: 'shop', POSTGRES_APP_DB_TEST: '' });
    expect(() => startRecipe(e, 'srv1', 'install-redis', {})).toThrow(/already running/);
    expect(recipeRuns(e, 'srv1')[0]).toMatchObject({ status: 'running', recipe: 'install-postgres' });
    await waitFor(() => recipeRuns(e, 'srv1')[0]?.status !== 'running');
    const [run] = recipeRuns(e, 'srv1');
    expect(run).toMatchObject({ status: 'ok', exitCode: 0, recipe: 'install-postgres', title: 'PostgreSQL (with pgvector) on this server', reason: null });
    expect(run!.outputTail).toContain('ran as sudo');
    expect(log()).toEqual(['ssh|deploy@h.example|sudo -n true', 'ssh|deploy@h.example|sudo -n bash -c "$(cat)" < /dev/null']);
    const script = readFileSync(join(fakes, 'script.sh'), 'utf8');
    expect(script.startsWith("export POSTGRES_APP_PASSWORD='hunter2-secret'\nexport POSTGRES_APP_DB='shop'\n#!/usr/bin/env bash\n# foundry-recipe: install-postgres")).toBe(true);
    expect(script).not.toContain('export POSTGRES_APP_DB_TEST=');
    // the record: the inputs by name, never the secret's value
    const events = e.store.listByType('server.recipe_finished', 10).concat(e.store.listByType('server.recipe_started', 10) as never);
    expect(JSON.stringify(events)).not.toContain('hunter2');
    expect((e.store.listByType('server.recipe_started', 10)[0]!.payload as { params: string[] }).params).toEqual(['POSTGRES_APP_PASSWORD', 'POSTGRES_APP_DB']);
    // the key file is gone
    expect(existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : []).toEqual([]);
    rmSync(fakes, { recursive: true, force: true });
  }, 30_000);

  test('root runs it as itself; a user who cannot sudo without a password is told and nothing runs; a failing script says its last words', async () => {
    const asRoot = await ready('root');
    startRecipe(asRoot.e, 'srv1', 'install-redis', {});
    await waitFor(() => recipeRuns(asRoot.e, 'srv1')[0]?.status !== 'running');
    expect(asRoot.log()).toEqual(['ssh|root@h.example|bash -c "$(cat)" < /dev/null']);
    expect(recipeRuns(asRoot.e, 'srv1')[0]).toMatchObject({ status: 'ok' });
    rmSync(asRoot.fakes, { recursive: true, force: true });

    const noSudo = await ready();
    writeFileSync(join(noSudo.fakes, 'NOSUDO'), '');
    startRecipe(noSudo.e, 'srv1', 'install-docker', { TARGET_USER: 'deploy' });
    await waitFor(() => recipeRuns(noSudo.e, 'srv1')[0]?.status !== 'running');
    expect(recipeRuns(noSudo.e, 'srv1')[0]).toMatchObject({ status: 'failed', reason: expect.stringContaining('deploy cannot run commands as root on h.example without a password') });
    expect(noSudo.log()).toEqual(['ssh|deploy@h.example|sudo -n true']);
    expect(existsSync(join(noSudo.fakes, 'script.sh'))).toBe(false);
    rmSync(noSudo.fakes, { recursive: true, force: true });

    const failing = await ready('root');
    writeFileSync(join(failing.fakes, 'FAIL'), '');
    startRecipe(failing.e, 'srv1', 'install-redis', {});
    await waitFor(() => recipeRuns(failing.e, 'srv1')[0]?.status !== 'running');
    expect(recipeRuns(failing.e, 'srv1')[0]).toMatchObject({ status: 'failed', exitCode: 100, reason: 'the script failed (exit 100): ran as bash · E: Unable to locate package nope' });
    rmSync(failing.fakes, { recursive: true, force: true });
  }, 30_000);
});
