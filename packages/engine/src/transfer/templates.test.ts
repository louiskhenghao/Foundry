import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TRANSFER_FORMAT_VERSION, TRANSFER_FORMAT_VERSION_PLAIN } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner } from '../test-helpers.ts';
import { engineTransferHost, exportTransfer } from './export.ts';
import { applyIncoming, receiveTransfer } from './import.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let tmp: string;
const engines: Engine[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'foundry-transfer-templates-'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
});

function engine(name: string) {
  const dataDir = join(tmp, name);
  const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), log: () => {} }), new FakeRunner(() => {}));
  engines.push(e);
  return e;
}

const DIGEST = (name: string) => `---\nname: ${name}\nnature: docs\n---\n\nWrite the {{week}} digest.\n`;
const THEME = JSON.stringify({ $schema: './theme.schema.json', name: 'Night shift', light: { page: '#f4f1ea', panel: '#fffdf8', line: '#e2dccf', ink: '#2b2622' }, dark: { page: '#16130f', panel: '#201c17', line: '#36302a', ink: '#efe9df' } }, null, 2);

/** the person's own files on a computer: two languages of one template, a template named like a built-in one, a theme */
function ownFiles(dataDir: string) {
  mkdirSync(join(dataDir, 'templates'), { recursive: true });
  mkdirSync(join(dataDir, 'themes'), { recursive: true });
  writeFileSync(join(dataDir, 'templates', 'weekly-digest.md'), DIGEST('Weekly digest'));
  writeFileSync(join(dataDir, 'templates', 'weekly-digest.zh.md'), DIGEST('每周简报').replace('---\nname', '---\nlang: zh\nname'));
  writeFileSync(join(dataDir, 'templates', 'code-feature.md'), DIGEST('My feature'));
  writeFileSync(join(dataDir, 'templates', 'broken.md'), 'no frontmatter');
  writeFileSync(join(dataDir, 'themes', 'night-shift.json'), THEME);
  writeFileSync(join(dataDir, 'themes', 'theme.schema.json'), '{}');
}

test('Templates & themes travel only when ticked, in the second format; a file without them is still the first format', async () => {
  const a = engine('a');
  ownFiles(a.config.dataDir);
  a.updateSettings({ models: { cheap: 'sonnet' } });
  const plain = await exportTransfer(engineTransferHost(a), { categories: { settings: true }, out: join(tmp, 'plain.tgz') });
  expect(plain.manifest.formatVersion).toBe(TRANSFER_FORMAT_VERSION_PLAIN);
  expect(plain.manifest.categories.templates).toBeUndefined();
  expect(plain.manifest.templates).toEqual([]);

  const full = await exportTransfer(engineTransferHost(a), { categories: { templates: true }, out: join(tmp, 'full.tgz') });
  expect(full.manifest.formatVersion).toBe(TRANSFER_FORMAT_VERSION);
  expect(full.manifest.categories.templates).toBe(true);
  // the file that cannot be read stays behind; the schema beside the themes is never a theme
  expect(full.manifest.templates).toEqual([
    { file: 'code-feature.md', name: 'My feature' },
    { file: 'weekly-digest.md', name: 'Weekly digest' },
    { file: 'weekly-digest.zh.md', name: '每周简报' },
  ]);
  expect(full.manifest.themes).toEqual([{ file: 'night-shift.json', name: 'Night shift' }]);
}, 30_000);

test('on the other computer the files come in beside the ones there: identical skipped, a clash numbered with its languages together, a built-in name numbered', async () => {
  const a = engine('a');
  ownFiles(a.config.dataDir);
  const file = join(tmp, 'own.tgz');
  await exportTransfer(engineTransferHost(a), { categories: { templates: true }, out: file });

  const b = engine('b');
  // b already has the digest in English, worded differently, and the very same theme
  mkdirSync(join(b.config.dataDir, 'templates'), { recursive: true });
  mkdirSync(join(b.config.dataDir, 'themes'), { recursive: true });
  writeFileSync(join(b.config.dataDir, 'templates', 'weekly-digest.md'), DIGEST('Weekly digest, as b writes it'));
  writeFileSync(join(b.config.dataDir, 'themes', 'night-shift.json'), THEME);

  const report = await receiveTransfer(b, file);
  expect(report.categories.templates).toBe(true);
  expect(report.templates.map((t) => t.name)).toEqual(['My feature', 'Weekly digest', '每周简报']);
  expect(report.themes).toEqual([{ file: 'night-shift.json', name: 'Night shift' }]);

  const applied = await applyIncoming(b, report.uploadId, {});
  expect(applied.templates).toEqual({ imported: ['My feature (as code-feature-2)', 'Weekly digest (as weekly-digest-2)', '每周简报 (as weekly-digest-2)'], skipped: [] });
  expect(applied.themes).toEqual({ imported: [], skipped: ['Night shift (already here)'] });
  const tdir = join(b.config.dataDir, 'templates');
  expect(readFileSync(join(tdir, 'weekly-digest.md'), 'utf8')).toContain('as b writes it');
  expect(readFileSync(join(tdir, 'weekly-digest-2.md'), 'utf8')).toBe(DIGEST('Weekly digest'));
  expect(existsSync(join(tdir, 'weekly-digest-2.zh.md'))).toBe(true);
  // a template named like one Foundry ships cannot shadow it (the server would list it as a problem)
  expect(existsSync(join(tdir, 'code-feature.md'))).toBe(false);
  expect(readFileSync(join(tdir, 'code-feature-2.md'), 'utf8')).toBe(DIGEST('My feature'));
  // asked to leave them out, nothing is written
  const c = engine('c');
  const again = await receiveTransfer(c, file);
  const left = await applyIncoming(c, again.uploadId, { templates: false });
  expect(left.templates).toEqual({ imported: [], skipped: [] });
  expect(existsSync(join(c.config.dataDir, 'templates'))).toBe(false);
}, 30_000);
