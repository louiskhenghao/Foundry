import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A Claude Code that says the version in its `version` file and, on `update`, moves to `next` (when there is one). It
 * names claude-fable-5-2 in its own text, as a real binary names the models it knows.
 */
function fakeClaude(version: string, next: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-cli-update-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'version'), version);
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/bin/sh
# claude-fable-5-2
case "$1" in
  --version) echo "$(cat '${dir}/version') (Claude Code)" ;;
  update) ${next ? `echo 'Updating…'; echo '${next}' > '${dir}/version'` : "echo 'Claude Code is up to date'"} ;;
  *) echo 'usage' ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-cli-update-data-'));
  dirs.push(dataDir);
  const engine = new Engine(defaultConfig(ROOT, { provider: 'claude', dataDir, claudeHome: join(dataDir, 'claude-home'), claudeBin: bin, log: () => {} }), new FakeRunner(() => {}));
  engines.push(engine);
  engine.newestCli = async () => '2.1.329';
  return { engine, bin, dir };
}

describe('updating a coding agent CLI from Foundry', () => {
  test('an older Claude Code is outdated, Setup says so with an Update, and the update moves it and syncs the models', async () => {
    const { engine, bin, dir } = fakeClaude('2.1.312', '2.1.329');
    expect(await engine.agentCliStatus('claude')).toEqual({ provider: 'claude', id: 'claude-code', label: 'Claude Code', installed: true, version: '2.1.312', newest: '2.1.329', outdated: true, command: `'${bin}' update` });

    const report = await engine.doctor('claude');
    const check = report.checks.find((c) => c.id === 'agent-cli-version')!;
    expect(check).toMatchObject({ label: 'Claude Code version', ok: false, severity: 'warn', fix: { installId: 'claude-code', action: 'update-tool', command: `'${bin}' update` } });
    expect(check.detail).toContain('2.1.312 is installed and 2.1.329 is out');

    const lines: string[] = [];
    const r = await engine.installTool('claude-code', (l) => lines.push(l), 'claude');
    expect(r).toMatchObject({ ok: true, exitCode: 0, command: `'${bin}' update` });
    expect(readFileSync(join(dir, 'version'), 'utf8').trim()).toBe('2.1.329');
    expect(lines).toContain(`$ '${bin}' update`);
    expect(lines.some((l) => l.startsWith('■ Claude Code 2.1.312 → 2.1.329'))).toBe(true);
    // the new release's models are synced: the binary's ids are read and the sync notes the new version
    expect(lines.some((l) => l.startsWith('■ models synced'))).toBe(true);
    expect(engine.models.syncState().cliVersion).toBe('2.1.329');
    // found in the new binary, not only the seed list Foundry ships
    expect(engine.listModels('claude').find((m) => m.name === 'claude-fable-5-2')?.discovered).toBeTruthy();
    expect((await engine.agentCliStatus('claude')).outdated).toBe(false);
  });

  test('an updater with nothing newer leaves it as it was, says so, and syncs nothing', async () => {
    const { engine } = fakeClaude('2.1.311', null);
    const lines: string[] = [];
    const r = await engine.installTool('claude-code', (l) => lines.push(l), 'claude');
    expect(r.ok).toBe(true);
    expect(lines).toContain('■ Claude Code is still 2.1.311: its updater had nothing newer for this install');
    expect(lines.some((l) => l.includes('models synced'))).toBe(false);
  });

  test('up to date, or the newest release unknown: the Setup line is green and offers nothing', async () => {
    const { engine } = fakeClaude('2.1.329', null);
    expect((await engine.agentCliStatus('claude')).outdated).toBe(false);
    const fresh = fakeClaude('2.1.312', null).engine;
    fresh.newestCli = async () => null;
    const check = (await fresh.doctor('claude')).checks.find((c) => c.id === 'agent-cli-version')!;
    expect(check).toMatchObject({ ok: true, fix: null, detail: '2.1.312 (the newest release could not be looked up)' });
  });
});
