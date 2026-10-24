#!/usr/bin/env node
// Put the sound on the picture (ADR-0076): node motion/lib/mix.mjs <silent.mp4> --out final.mp4 [--music score.wav] [--sfx sfx.wav] [--music-gain 1] [--sfx-gain 1] [--lufs -14]
// The tracks are mixed, normalised to the target loudness (EBU R128, the platforms' -14 LUFS), encoded AAC, and muxed
// with the video stream copied as it is, so the picture stays byte for byte what render.mjs made.
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const out = opt('out', null);
const music = opt('music', null), sfx = opt('sfx', null);
if (!video || !out || (!music && !sfx)) { console.error('usage: mix.mjs <silent.mp4> --out final.mp4 [--music score.wav] [--sfx sfx.wav] [--music-gain g] [--sfx-gain g] [--lufs -14]'); process.exit(2); }
const lufs = Number(opt('lufs', -14));
const inputs = ['-i', video];
const tracks = [];
if (music) { inputs.push('-i', music); tracks.push(`[${tracks.length + 1}:a]volume=${opt('music-gain', 1)}[m]`); }
if (sfx) { inputs.push('-i', sfx); tracks.push(`[${tracks.length + 1}:a]volume=${opt('sfx-gain', 1)}[s]`); }
const labels = (music ? '[m]' : '') + (sfx ? '[s]' : '');
// the tracks summed, then a limiter: peaks held under -1.5 dBTP so the loudness pass can raise the level in a straight line instead of ducking around the kicks
const summed = tracks.length === 2 ? `${tracks.join(';')};${labels}amix=inputs=2:duration=first:normalize=0[sum]` : `${tracks[0].replace(/\[(m|s)\]$/, '[sum]')}`;
const mixed = `${summed};[sum]alimiter=limit=0.84:attack=3:release=40:level=false[mix]`;
// two passes: loudnorm in one pass guesses as it goes and lands a short film a couple of LU low; measured first, it lands on the target
const measure = spawnSync('ffmpeg', ['-nostats', ...inputs, '-filter_complex', `${mixed};[mix]loudnorm=I=${lufs}:TP=-1.5:LRA=11:print_format=json[a]`, '-map', '[a]', '-f', 'null', '-'], { encoding: 'utf8' });
const json = /\{[^{}]*"input_i"[\s\S]*?\}/.exec(measure.stderr)?.[0];
const m = json ? JSON.parse(json) : null;
if (!m) { console.error(`could not measure the loudness: ${measure.stderr.trim().slice(-300)}`); process.exit(1); }
const second = `loudnorm=I=${lufs}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
const filter = `${mixed};[mix]${second}[a]`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', resolve(out)], { stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`wrote ${out}: ${[music && 'music', sfx && 'sfx'].filter(Boolean).join(' + ')} at ${lufs} LUFS`);
