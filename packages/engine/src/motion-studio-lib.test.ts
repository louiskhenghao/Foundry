import { describe, expect, test } from 'bun:test';
import { beats, loopT, rng, spring, stagger, track, unit } from '../../../catalog/bundled/motion-studio/lib/motion.js';

describe('a film is a pure function of time', () => {
  test('a spring starts at 0, overshoots a little when underdamped, settles at 1, and never depends on history', () => {
    expect(spring(0)).toBe(0);
    expect(spring(-1)).toBe(0);
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => spring(i / 100, 200, 14)));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.5);
    expect(spring(3, 170, 26)).toBeCloseTo(1, 4);
    expect(spring(0.37, 170, 26)).toBe(spring(0.37, 170, 26));
    // critically and over-damped: no overshoot
    for (const d of [2 * Math.sqrt(170), 40]) for (let i = 0; i < 300; i++) expect(spring(i / 100, 170, d)).toBeLessThanOrEqual(1.000001);
  });
  test('a track sums one spring per change and lands on the last value', () => {
    const keys: [number, number][] = [[0, 0], [1, 100], [2, 40]];
    expect(track(0, keys)).toBe(0);
    expect(track(1.5, keys)).toBeGreaterThan(90);
    expect(track(6, keys)).toBeCloseTo(40, 3);
  });
  test('seeded noise repeats; the loop folds time; a stagger grows with the index', () => {
    const a = rng(42); const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(1)()).not.toBe(rng(2)());
    expect(loopT(15.5, 15)).toBeCloseTo(0.5);
    expect(loopT(-0.5, 15)).toBeCloseTo(14.5);
    expect(stagger(3, 0.1)).toBeCloseTo(0.3);
    expect(unit(1.5, 1, 2)).toBe(0.5);
  });
  test('a beat grid at 120 BPM: half a second a beat, from the phase', () => {
    const g = beats(120, 0.1);
    expect(g.period).toBe(0.5);
    expect(g.at(4)).toBeCloseTo(2.1);
    expect(g.index(2.1)).toBeCloseTo(4);
    expect(g.nearest(2.3)).toBeCloseTo(2.1);
  });
});

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SKILL = resolve(import.meta.dir, '../../../catalog/bundled/motion-studio');
const PLAYWRIGHT = resolve(import.meta.dir, '../node_modules/playwright');
const chromium = (() => { try { return existsSync(require('playwright').chromium.executablePath()); } catch { return false; } })();
const tools = !!Bun.which('ffmpeg') && !!Bun.which('ffprobe') && chromium;

describe('the motion-studio harness, laid out and rendered (ADR-0077)', () => {
  const run = (cwd: string, args: string[]) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, FOUNDRY_PLAYWRIGHT: PLAYWRIGHT } });
  test('scaffold lays a film out with the renderer, the helpers and the templates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'motion-'));
    const r = run(dir, [join(SKILL, 'scripts', 'scaffold.mjs'), 'demo', '--title', 'Demo', '--dur', '2', '--fps', '24', '--formats', '16x9,9x16', '--bpm', '120']);
    expect(r.status).toBe(0);
    for (const f of ['motion/lib/render.mjs', 'motion/lib/motion.js', 'motion/lib/verify.mjs', 'motion/demo/index.html', 'motion/demo/film.js', 'motion/demo/STORYBOARD.md']) expect(existsSync(join(dir, f))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'motion/demo/film.json'), 'utf8'))).toMatchObject({ title: 'Demo', duration: 2, fps: 24, formats: ['16x9', '9x16'], bpm: 120 });
    expect(readFileSync(join(dir, 'motion/demo/film.js'), 'utf8')).toContain('window.FILM');
    rmSync(dir, { recursive: true, force: true });
  });
  test.skipIf(!tools)('a slice renders the same bytes twice, and the file verify.mjs measures is what the contract asks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'motion-'));
    expect(run(dir, [join(SKILL, 'scripts', 'scaffold.mjs'), 'demo', '--dur', '2', '--fps', '12']).status).toBe(0);
    const a = run(dir, ['motion/lib/render.mjs', 'motion/demo', '--hash', '--from', '0', '--to', '1', '--sub', '1']);
    const b = run(dir, ['motion/lib/render.mjs', 'motion/demo', '--hash', '--from', '0', '--to', '1', '--sub', '1']);
    expect(a.status).toBe(0);
    const ha = /"sha1":"([0-9a-f]+)"/.exec(a.stdout)?.[1];
    expect(ha).toBeTruthy();
    expect(/"sha1":"([0-9a-f]+)"/.exec(b.stdout)?.[1]).toBe(ha);
    const out = join(dir, 'artifacts/motion/demo');
    expect(run(dir, ['motion/lib/render.mjs', 'motion/demo', '--out', join(out, 'silent.mp4'), '--sub', '1']).status).toBe(0);
    expect(run(dir, ['motion/lib/score.mjs', '--bpm', '120', '--dur', '2', '--out', join(out, 'score.wav')]).status).toBe(0);
    expect(run(dir, ['motion/lib/mix.mjs', join(out, 'silent.mp4'), '--out', join(out, 'final-16x9.mp4'), '--music', join(out, 'score.wav')]).status).toBe(0);
    expect(run(dir, ['motion/lib/sheets.mjs', join(out, 'final-16x9.mp4'), '--out', out]).status).toBe(0);
    expect(existsSync(join(out, 'contact.png'))).toBe(true);
    const v = run(dir, ['motion/lib/verify.mjs', join(out, 'final-16x9.mp4'), '--film', 'motion/demo', '--no-loop', '--no-determinism']);
    expect(v.stdout).toContain('ok   codec');
    expect(v.stdout).toContain('ok   size: 1920x1080');
    expect(v.stdout).toContain('ok   duration');
    expect(v.stdout).toContain('ok   audio');
    rmSync(dir, { recursive: true, force: true });
  }, 180_000);
});
