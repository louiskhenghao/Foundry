import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Markitdown } from './markitdown.ts';

/** Fake `markitdown <input> -o <out>`: writes a markdown rendition of the input (or fails on demand). */
const fakeExec =
  (behaviour: 'ok' | 'fail' | 'big' = 'ok') =>
  async (cmd: string[], _cwd: string) => {
    if (cmd[1] === '--version') return { code: 0, stdout: 'markitdown 0.1.4\n', stderr: '' };
    const out = cmd[cmd.indexOf('-o') + 1]!;
    if (behaviour === 'fail') return { code: 1, stdout: '', stderr: 'Traceback…\nUnsupportedFormatException: nope' };
    writeFileSync(out, behaviour === 'big' ? '#'.repeat(3000) : `# converted\n\nfrom ${cmd[1]}\n`);
    return { code: 0, stdout: '', stderr: '' };
  };

const dir = () => mkdtempSync(join(tmpdir(), 'mkd-'));

describe('Markitdown', () => {
  test('unavailable when neither PATH nor ~/.local/bin has it; explicit bin must exist', () => {
    const m = new Markitdown({ which: () => null, bin: '/definitely/not/here' });
    expect(m.available()).toBe(false);
    expect(m.installCommand()).toBeNull();
    const withUv = new Markitdown({ which: (b) => (b === 'uv' ? '/opt/homebrew/bin/uv' : null) });
    expect(withUv.installCommand()).toEqual(['/opt/homebrew/bin/uv', 'tool', 'install', '--python', '3.12', 'markitdown[all]']);
  });

  test('canConvert: documents yes, images/text no', () => {
    const m = new Markitdown({ which: () => null });
    expect(m.canConvert('spec.pdf', 'application/pdf')).toBe(true);
    expect(m.canConvert('deck.PPTX', null)).toBe(true);
    expect(m.canConvert('page.html', 'text/html')).toBe(true);
    expect(m.canConvert('mock.png', 'image/png')).toBe(false);
    expect(m.canConvert('notes.md', 'text/markdown')).toBe(false);
    expect(m.canConvert('data.bin', 'application/octet-stream')).toBe(false);
    expect(m.canConvert('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
  });

  test('convertFile writes next to the requested path and reports size; failures carry the last stderr line', async () => {
    const d = dir();
    const src = join(d, 'spec.pdf');
    writeFileSync(src, 'pdf');
    const m = new Markitdown({ which: (b) => (b === 'markitdown' ? '/fake/markitdown' : null), exec: fakeExec('ok') as any });
    expect(m.available()).toBe(true);
    const r = await m.convertFile(src, join(d, 'out', 'spec.pdf.md'));
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(10);
    expect(readFileSync(join(d, 'out', 'spec.pdf.md'), 'utf8')).toContain('# converted');
    const f = await new Markitdown({ which: () => '/fake/markitdown', exec: fakeExec('fail') as any }).convertFile(src, join(d, 'x.md'));
    expect(f.ok).toBe(false);
    expect(f.error).toContain('UnsupportedFormatException');
    expect(existsSync(join(d, 'x.md'))).toBe(false);
    expect((await m.convertFile(join(d, 'missing.pdf'), join(d, 'm.md'))).error).toBe('source file missing');
  });

  test('oversized output is truncated with a trailer', async () => {
    const d = dir();
    const m = new Markitdown({ which: () => '/fake/markitdown', exec: fakeExec('big') as any, maxBytes: 1000 });
    const r = await m.convertFile((writeFileSync(join(d, 'a.docx'), 'x'), join(d, 'a.docx')), join(d, 'a.docx.md'));
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(readFileSync(join(d, 'a.docx.md'), 'utf8')).toContain('output truncated');
  });

  test('convertUrl accepts only http(s)', async () => {
    const d = dir();
    const m = new Markitdown({ which: () => '/fake/markitdown', exec: fakeExec('ok') as any });
    expect((await m.convertUrl('ftp://x', join(d, 's.md'))).ok).toBe(false);
    const r = await m.convertUrl('https://example.com/docs', join(d, 'snapshot.md'));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(d, 'snapshot.md'), 'utf8')).toContain('https://example.com/docs');
  });

  test('version() parses the first line', async () => {
    const m = new Markitdown({ which: () => '/fake/markitdown', exec: fakeExec('ok') as any });
    expect(await m.version()).toBe('markitdown 0.1.4');
  });
});
