import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIB = resolve(import.meta.dir, '../../../catalog/bundled/hyperframes-harness/lib');
const ffmpeg = Bun.which('ffmpeg') && Bun.which('ffprobe');
const run = (script: string, args: string[]) => spawnSync('node', [join(LIB, script), ...args], { encoding: 'utf8' });

/** the harness's scripts over a clip ffmpeg makes: two seconds of test bars with a quiet tone, 1920x1080, H.264 (ADR-0087) */
describe.skipIf(!ffmpeg)('the HyperFrames harness scripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-hf-lib-'));
  const clip = join(dir, 'render-16x9.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-filter:a', 'volume=0.05', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  writeFileSync(join(dir, 'index.html'), '<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2"></div>');

  test('verify: the contract measured — a quiet clip fails loudness, the wrong format fails size, the composition gives the duration', () => {
    const quiet = run('verify.mjs', [clip, '--format', '16x9', '--duration', '2']);
    expect(quiet.status).toBe(1);
    expect(quiet.stdout).toContain('ok   codec: h264');
    expect(quiet.stdout).toContain('ok   size: 1920x1080 for 16x9');
    expect(quiet.stdout).toContain('ok   duration: 2.00s');
    expect(quiet.stdout).toContain('ok   audio: present');
    expect(quiet.stdout).toMatch(/FAIL loudness: -[\d.]+ LUFS \(target -14 ±1\)/);
    expect(run('verify.mjs', [clip, '--format', '9x16', '--composition', join(dir, 'index.html')]).stdout).toContain('FAIL size: 1920x1080 for 9x16');
    expect(run('verify.mjs', [clip, '--format', '16x9', '--composition', join(dir, 'index.html'), '--lufs', '-99']).stdout).toContain('expected 2s');
    expect(run('verify.mjs', [clip]).status).toBe(2);
  });
  test('loudness: the two-pass pass lands the clip on -14 LUFS with the video copied, and verify passes', () => {
    const out = join(dir, 'final-16x9.mp4');
    const r = run('loudness.mjs', [clip, '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('at -14 LUFS');
    const v = run('verify.mjs', [out, '--format', '16x9', '--duration', '2']);
    expect(v.stdout).toContain('all 6 checks passed');
    expect(v.status).toBe(0);
  });
  test('sheets: contact, phone and poster from the clip, and a strip around a second', () => {
    const out = join(dir, 'sheets');
    expect(run('sheets.mjs', [clip, '--out', out]).status).toBe(0);
    for (const f of ['contact.png', 'phone.png', 'poster.png']) expect(existsSync(join(out, f))).toBe(true);
    expect(run('sheets.mjs', [clip, '--out', out, '--strip', '1']).status).toBe(0);
    expect(existsSync(join(out, 'strip.png'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
