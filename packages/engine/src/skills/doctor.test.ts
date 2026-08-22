import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogStatus, loadCatalog } from './catalog.ts';
import { runDoctor } from './doctor.ts';
import { makeFakeHome, writeCatalog } from './fake-home.test-helper.ts';
import { scanSkills } from './scanner.ts';

const fake = makeFakeHome();
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

function fakeBin(dir: string, name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${script}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe('doctor', () => {
  const bins = join(fake.home, 'bin');
  const claude = fakeBin(bins, 'claude', 'case "$1" in --version) echo "2.1.238 (Claude Code)";; auth) echo "{\\"loggedIn\\":false}";; esac');
  const catalogPath = writeCatalog(join(fake.home, 'doc-cat'), [{ id: 'graphify', name: 'graphify', summary: '', why: 'needed for context', tier: 'required', source: { type: 'cli', detect: 'graphify', install: 'uv tool install graphifyy', docs: 'https://example.com' } }]);
  const catalog = loadCatalog(catalogPath);
  const which = (b: string) => (b === 'git' ? '/usr/bin/git' : b === 'bun' ? '/usr/local/bin/bun' : null);

  test('reports each check with fixes', async () => {
    const statuses = catalogStatus(catalog, scanSkills(fake.paths), fake.paths, which);
    const r = await runDoctor({ paths: fake.paths, catalog, statuses, claudeBin: claude, which });
    const by = (id: string) => r.checks.find((c) => c.id === id)!;
    expect(by('claude-bin')).toMatchObject({ ok: true, detail: '2.1.238 (Claude Code)' });
    expect(by('claude-auth')).toMatchObject({ ok: false, fix: { command: 'claude auth login' } });
    expect(by('git').ok).toBe(true);
    expect(by('bun').ok).toBe(true);
    expect(by('required:graphify')).toMatchObject({ ok: false, fix: { command: 'uv tool install graphifyy', installId: 'graphify', url: 'https://example.com' } });
    expect(by('skills-dir').ok).toBe(true);
    expect(by('settings-json')).toMatchObject({ ok: false, severity: 'warn' });
    expect(by('settings-json').detail).toContain('/definitely/missing/hook.sh');
    expect(r.ok).toBe(false);
  });

  test('all green when everything is present; warnings do not fail the report', async () => {
    const claudeOk = fakeBin(join(fake.home, 'bin2'), 'claude', 'case "$1" in --version) echo "2.1.238";; auth) echo "{\\"loggedIn\\":true,\\"email\\":\\"a@b\\",\\"subscriptionType\\":\\"max\\"}";; esac');
    mkdirSync(join(fake.paths.skillsDir, 'graphify'), { recursive: true });
    writeFileSync(join(fake.paths.skillsDir, 'graphify', 'SKILL.md'), '---\nname: graphify\ndescription: g\n---\n');
    const whichAll = (b: string) => `/bin/${b}`;
    const statuses = catalogStatus(catalog, scanSkills(fake.paths), fake.paths, whichAll);
    const r = await runDoctor({ paths: fake.paths, catalog, statuses, claudeBin: claudeOk, which: whichAll });
    expect(r.checks.find((c) => c.id === 'claude-auth')).toMatchObject({ ok: true, detail: 'logged in as a@b (max)' });
    expect(r.checks.find((c) => c.id === 'required:graphify')!.ok).toBe(true);
    expect(r.ok).toBe(true); // only the settings.json warning remains
  });

  test('missing claude binary', async () => {
    const statuses = catalogStatus(catalog, scanSkills(fake.paths), fake.paths, () => null);
    const r = await runDoctor({ paths: fake.paths, catalog, statuses, which: () => null });
    expect(r.checks.find((c) => c.id === 'claude-bin')).toMatchObject({ ok: false, fix: { url: 'https://code.claude.com/docs/en/setup' } });
  });
});
