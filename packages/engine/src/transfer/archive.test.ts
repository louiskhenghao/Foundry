import { afterEach, expect, test } from 'bun:test';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packTransfer, unpackTransfer } from './archive.ts';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('a staged folder is packed with what its links point at, and unpacks to plain files', async () => {
  root = mkdtempSync(join(tmpdir(), 'foundry-archive-'));
  const data = join(root, 'data');
  mkdirSync(join(data, 'attachments', 'g1'), { recursive: true });
  writeFileSync(join(data, 'attachments', 'g1', 'spec.pdf'), 'pdf');
  writeFileSync(join(data, 't.jsonl'), 'transcript');
  const stage = join(root, 'stage');
  mkdirSync(join(stage, 'transcripts'), { recursive: true });
  writeFileSync(join(stage, 'manifest.json'), '{}');
  symlinkSync(join(data, 'attachments'), join(stage, 'attachments'));
  symlinkSync(join(data, 't.jsonl'), join(stage, 'transcripts', 't.jsonl'));
  await packTransfer(stage, join(root, 'out', 'f.tgz'));
  const out = join(root, 'in');
  await unpackTransfer(join(root, 'out', 'f.tgz'), out);
  expect(readFileSync(join(out, 'attachments', 'g1', 'spec.pdf'), 'utf8')).toBe('pdf');
  expect(readFileSync(join(out, 'transcripts', 't.jsonl'), 'utf8')).toBe('transcript');
  expect(lstatSync(join(out, 'attachments')).isDirectory()).toBe(true);
});

test('a file holding a link, or no tar at all, is refused', async () => {
  root = mkdtempSync(join(tmpdir(), 'foundry-archive-'));
  const evil = join(root, 'evil');
  mkdirSync(evil);
  symlinkSync('/etc/hosts', join(evil, 'hosts'));
  await Bun.$`tar -czf ${join(root, 'evil.tgz')} -C ${evil} .`.quiet();
  await expect(unpackTransfer(join(root, 'evil.tgz'), join(root, 'x'))).rejects.toThrow('other than files');
  writeFileSync(join(root, 'junk.tgz'), 'not a tar');
  await expect(unpackTransfer(join(root, 'junk.tgz'), join(root, 'y'))).rejects.toThrow('does not unpack');
});
