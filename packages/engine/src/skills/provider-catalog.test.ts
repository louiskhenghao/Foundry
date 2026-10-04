import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';

const home = mkdtempSync(join(tmpdir(), 'foundry-provider-catalog-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

test('provider catalog controls installs, bundles, hints and manual commands using the native source', async () => {
  const upstream = join(home, 'upstream');
  for (const [path, description] of [['claude/portable', 'Claude variant'], ['.agents/portable', 'Codex variant'], ['skills/claude-only', 'Requires Claude']]) {
    mkdirSync(join(upstream, path!), { recursive: true });
    writeFileSync(join(upstream, path!, 'SKILL.md'), skillMd(path!.split('/').at(-1)!, description));
  }
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'test: add skill fixtures']]) {
    const child = Bun.spawn(['git', ...args], { cwd: upstream, stdout: 'ignore', stderr: 'pipe' });
    expect(await child.exited).toBe(0);
  }
  const source = { type: 'git', repo: 'fixture/skills', url: `file://${upstream}` };
  const base = { summary: '', why: '', tier: 'recommended', bundle: 'fixture', roles: ['worker'] };
  const catalogPath = writeCatalog(join(home, 'catalog'), [
    { ...base, id: 'portable', name: 'portable', source: { ...source, path: 'claude/portable' }, providerSources: { codex: { ...source, path: '.agents/portable' } } },
    { ...base, id: 'claude-only', name: 'claude-only', providers: ['claude'], source: { ...source, path: 'skills/claude-only' } },
    { ...base, id: 'tool', name: 'tool', source: { type: 'cli', detect: 'tool', install: 'tool install --platform claude' }, providerSources: { codex: { type: 'cli', detect: 'tool', install: 'tool install --platform codex' } } },
    { ...base, id: 'missing-native', name: 'portable', source: { ...source, path: '.agents/deleted' } },
  ]);
  const manager = (provider: 'claude' | 'codex') => new SkillsManager({ provider, claudeHome: join(home, provider), dataDir: join(home, 'data', provider), catalogPath, which: () => null });
  const claude = manager('claude');
  const codex = manager('codex');
  // Neither hidden recommendations nor direct API requests may install an unsupported source.
  await expect(codex.install('claude-only')).rejects.toThrow(/not in the catalog/);
  const bundle = await codex.installBundle('fixture');
  expect(bundle.results.find((r) => r.id === 'portable')?.action).toBe('installed');
  expect(bundle.results.some((r) => r.id === 'claude-only')).toBe(false);
  expect(readFileSync(join(codex.paths.skillsDir, 'portable', 'SKILL.md'), 'utf8')).toContain('Codex variant');
  expect((await codex.install('tool')).manual?.command).toBe('tool install --platform codex');
  expect(await codex.hints.hintFor('worker')).not.toContain('claude-only');
  await claude.install('portable');
  await claude.install('claude-only');
  expect(readFileSync(join(claude.paths.skillsDir, 'portable', 'SKILL.md'), 'utf8')).toContain('Claude variant');
  expect(await claude.hints.hintFor('worker')).toContain('claude-only');
  expect((await claude.install('tool')).manual?.command).toBe('tool install --platform claude');
  // An explicit native path disappearing must not silently choose another platform's same-named skill.
  await expect(codex.install('missing-native', { force: true })).rejects.toMatchObject({ code: 'not-found' });
  expect(readFileSync(join(codex.paths.skillsDir, 'portable', 'SKILL.md'), 'utf8')).toContain('Codex variant');
  expect(existsSync(join(codex.paths.skillsDir, 'claude-only'))).toBe(false);
});
