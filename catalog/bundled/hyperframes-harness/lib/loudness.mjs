#!/usr/bin/env node
// Bring a rendered film to the loudness the platforms expect (ADR-0087): two-pass loudnorm to the target, the video
// stream copied, the result written beside the input or to --out.
//   node video/lib/loudness.mjs artifacts/video/<slug>/render-16x9.mp4 --out artifacts/video/<slug>/final-16x9.mp4 [--lufs -14]
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
if (!input) { console.error('usage: loudness.mjs <in.mp4> --out <out.mp4> [--lufs -14]'); process.exit(2); }
const out = opt('out', input.replace(/\.mp4$/, '-loud.mp4'));
const target = Number(opt('lufs', '-14'));
const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', input]).toString().trim();
if (probe !== 'audio') { console.error(`${input} has no audio stream: nothing to normalise`); process.exit(1); }
// pass one measures; pass two applies the measured values so the result lands on the target, not near it
const first = spawnSync('ffmpeg', ['-nostats', '-i', input, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
if (first.status !== 0) { console.error(first.stderr.trim().slice(-400)); process.exit(1); }
// ffmpeg prints the measurement as the last JSON object on stderr, with its own summary lines after it
const start = first.stderr.lastIndexOf('{');
const m = JSON.parse(first.stderr.slice(start, first.stderr.indexOf('}', start) + 1));
const filter = `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-c:v', 'copy', '-af', filter, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out], { stdio: 'inherit' });
console.log(`wrote ${out} at ${target} LUFS (was ${m.input_i} LUFS)`);
