#!/usr/bin/env node
// The pictures a film is judged by (ADR-0076), all from ffmpeg:
//   node motion/lib/sheets.mjs <video.mp4> --out <dir>            contact.png (2 frames a second, 6 across), phone.png (how it reads 360 px wide), poster.png
//   node motion/lib/sheets.mjs <video.mp4> --out <dir> --strip 4.2  strip.png: 12 consecutive frames from 4.2 s (pops, overlaps)
//   node motion/lib/sheets.mjs <video.mp4> --out <dir> --poster 12.5 the poster from that second instead of the middle
//   node motion/lib/sheets.mjs <video.mp4> --out <dir> --loop        loop_check.mp4: the film twice back to back, to watch the seam
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = (k) => args.includes('--' + k);
if (!video) { console.error('usage: sheets.mjs <video.mp4> --out <dir> [--strip <s>] [--poster <s>] [--loop]'); process.exit(2); }
const out = resolve(opt('out', '.'));
mkdirSync(out, { recursive: true });
const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (a) => execFileSync('ffprobe', ['-v', 'error', ...a]).toString().trim();
const dur = Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', video]));
const fps = Number(probe(['-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', video]).split('/').reduce((a, b) => Number(a) / Number(b)));
const made = [];
const rows = Math.max(1, Math.ceil((dur * 2) / 6));
if (!has('strip') && !has('loop') && !has('poster')) {
  ff(['-i', video, '-vf', `fps=2,scale=320:-1,tile=6x${rows}`, '-frames:v', '1', join(out, 'contact.png')]); made.push('contact.png');
  ff(['-i', video, '-vf', `fps=1,scale=360:-1,tile=5x${Math.max(1, Math.ceil(dur / 5))}`, '-frames:v', '1', join(out, 'phone.png')]); made.push('phone.png');
}
if (has('strip')) {
  const at = Number(opt('strip', '0'));
  ff(['-ss', String(Math.max(0, at - 1 / fps)), '-i', video, '-vf', 'scale=320:-1,tile=12x1', '-frames:v', '1', join(out, 'strip.png')]); made.push('strip.png');
}
if (!has('strip') && !has('loop')) {
  const at = Number(opt('poster', String(dur / 2)));
  ff(['-ss', String(at), '-i', video, '-frames:v', '1', join(out, 'poster.png')]); made.push('poster.png');
}
if (has('loop')) {
  ff(['-stream_loop', '1', '-i', video, '-c', 'copy', join(out, 'loop_check.mp4')]); made.push('loop_check.mp4');
}
console.log(`wrote ${made.join(', ')} to ${out} (${dur.toFixed(2)}s at ${fps} fps)`);
