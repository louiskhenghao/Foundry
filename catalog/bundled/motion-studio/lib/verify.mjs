#!/usr/bin/env node
// Measure a finished film against its contract (ADR-0076), with ffprobe and ffmpeg; exit 0 when every check passes.
//   node motion/lib/verify.mjs artifacts/motion/<film>/final-16x9.mp4 --film motion/<film> [--format 16x9] [--silent-ok] [--no-loop] [--no-determinism]
// Checks: H.264, yuv420p, the format's size, the duration within 0.1 s of film.json, an audio stream (unless --silent-ok),
// loudness within 1 LU of -14 LUFS, the loop seam (first frame ≈ last frame, unless --no-loop), and determinism: a
// 2-second sample rendered twice hashes the same (unless --no-determinism; needs the renderer and Chromium).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
if (!video || !opt('film', null)) { console.error('usage: verify.mjs <final.mp4> --film <film dir> [--format 16x9] [--silent-ok] [--no-loop] [--no-determinism]'); process.exit(2); }
const film = resolve(opt('film'));
const spec = JSON.parse(readFileSync(join(film, 'film.json'), 'utf8'));
const format = opt('format', spec.formats?.[0] ?? '16x9');
const want = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] }[format];
const probe = (a) => execFileSync('ffprobe', ['-v', 'error', ...a, video]).toString().trim();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); };

const v = Object.fromEntries(probe(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate', '-of', 'default=nw=1']).split('\n').map((l) => l.split('=')));
check('codec', v.codec_name === 'h264', `${v.codec_name}`);
check('pixel format', v.pix_fmt === 'yuv420p', `${v.pix_fmt}`);
check('size', Number(v.width) === want[0] && Number(v.height) === want[1], `${v.width}x${v.height} for ${format}`);
const dur = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0']));
check('duration', Math.abs(dur - spec.duration) <= 0.1, `${dur.toFixed(2)}s, film.json says ${spec.duration}s`);
const audio = probe(['-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0']) === 'audio';
if (has('silent-ok')) check('audio', true, audio ? 'present' : 'none, allowed');
else check('audio', audio, audio ? 'present' : 'none');
if (audio) {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', video, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr);
  const lufs = m ? Number(m[1]) : NaN;
  check('loudness', Number.isFinite(lufs) && Math.abs(lufs + 14) <= 1, Number.isFinite(lufs) ? `${lufs} LUFS (target -14 ±1)` : 'could not measure');
}
const renderer = join(dirname(fileURLToPath(import.meta.url)), 'render.mjs');
const run = (extra) => spawnSync(process.execPath, [renderer, film, '--format', format, ...extra], { encoding: 'utf8', env: process.env });
if (!has('no-loop')) {
  const r = run(['--seam']);
  const line = r.stdout.trim().split('\n').pop() ?? '';
  let seam = null; try { seam = JSON.parse(line); } catch {}
  check('loop seam', !!seam && seam.ok, seam ? `first and last frame differ by ${seam.seam} (ok below 0.02)` : `renderer failed: ${(r.stderr || r.stdout).trim().slice(-200)}`);
}
if (!has('no-determinism')) {
  const a = run(['--hash', '--from', '0', '--to', '2', '--sub', '1']), b = run(['--hash', '--from', '0', '--to', '2', '--sub', '1']);
  const ha = /"sha1":"([0-9a-f]+)"/.exec(a.stdout)?.[1], hb = /"sha1":"([0-9a-f]+)"/.exec(b.stdout)?.[1];
  check('determinism', !!ha && ha === hb, ha && hb ? (ha === hb ? `2-second sample hashes the same twice (${ha.slice(0, 7)})` : `hashes differ: ${ha.slice(0, 7)} vs ${hb.slice(0, 7)} (Math.random, a timer, or a clock in the film)`) : `renderer failed: ${(a.stderr || a.stdout).trim().slice(-200)}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
