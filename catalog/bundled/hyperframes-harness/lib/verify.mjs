#!/usr/bin/env node
// Measure a finished HyperFrames film against its contract (ADR-0087), with ffprobe and ffmpeg; exit 0 when every check passes.
//   node video/lib/verify.mjs artifacts/video/<slug>/final-16x9.mp4 --format 16x9 --duration 15 [--silent-ok] [--lufs -14]
//   node video/lib/verify.mjs artifacts/video/<slug>/final-16x9.mp4 --format 16x9 --composition video/<slug>/index.html
// Checks: H.264, yuv420p, the format's size, the duration within 0.1 s of --duration (or of the root composition's
// data-duration), an audio stream (unless --silent-ok), loudness within 1 LU of the target (-14 LUFS). A HyperFrames
// film is rendered from a timeline, not seeked: there is no loop seam and no determinism check here.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
if (!video || (!opt('duration', null) && !opt('composition', null))) { console.error('usage: verify.mjs <final.mp4> --format 16x9 (--duration <s> | --composition <index.html>) [--silent-ok] [--lufs -14]'); process.exit(2); }
const format = opt('format', '16x9');
const want = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] }[format];
if (!want) { console.error(`unknown format ${format}: 16x9, 9x16, 1x1 or 4x5`); process.exit(2); }
let expected = Number(opt('duration', NaN));
if (!Number.isFinite(expected)) {
  // the root composition's data-duration, the way the CLI reads the film's length
  const html = readFileSync(opt('composition'), 'utf8');
  const m = /data-composition-id=[^>]*?data-duration="([\d.]+)"/.exec(html) ?? /data-duration="([\d.]+)"[^>]*?data-composition-id=/.exec(html);
  expected = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(expected)) { console.error(`no data-duration on the root composition of ${opt('composition')}`); process.exit(2); }
}
const target = Number(opt('lufs', '-14'));
const probe = (a) => execFileSync('ffprobe', ['-v', 'error', ...a, video]).toString().trim();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); };

const v = Object.fromEntries(probe(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate', '-of', 'default=nw=1']).split('\n').map((l) => l.split('=')));
check('codec', v.codec_name === 'h264', `${v.codec_name}`);
check('pixel format', v.pix_fmt === 'yuv420p', `${v.pix_fmt}`);
check('size', Number(v.width) === want[0] && Number(v.height) === want[1], `${v.width}x${v.height} for ${format}`);
const dur = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0']));
check('duration', Math.abs(dur - expected) <= 0.1, `${dur.toFixed(2)}s, expected ${expected}s`);
const audio = probe(['-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0']) === 'audio';
if (has('silent-ok')) check('audio', true, audio ? 'present' : 'none, allowed');
else check('audio', audio, audio ? 'present' : 'none');
if (audio) {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', video, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(r.stderr);
  const lufs = m ? Number(m[1]) : NaN;
  check('loudness', Number.isFinite(lufs) && Math.abs(lufs - target) <= 1, Number.isFinite(lufs) ? `${lufs} LUFS (target ${target} ±1)` : 'could not measure');
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `${failed.length} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
