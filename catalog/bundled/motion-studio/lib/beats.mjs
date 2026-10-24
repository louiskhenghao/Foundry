#!/usr/bin/env node
// Measure a music track's grid (ADR-0076), with ffmpeg and nothing else: node motion/lib/beats.mjs track.wav [--hint 120] > beats.json
// ffmpeg decodes to mono PCM; an energy envelope over 11.6 ms hops gives onsets; the autocorrelation of the onset strength
// over 60–200 BPM gives the tempo (the hint breaks ties); the beat phase is the offset where the grid catches most onsets.
// An approximation, not a transcription: it finds the tempo of a track with a clear pulse and the beat it starts on;
// a rubato piece or a track with no drums gets a best guess, and the storyboard should say so.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : d; };
if (!file) { console.error('usage: beats.mjs track.wav [--hint 120] [--min 60] [--max 200]'); process.exit(2); }
const SR = 22050, HOP = 256;
const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
const frames = Math.floor(x.length / HOP);
// energy per hop, in a log scale, then the positive difference: an onset strength envelope
const e = new Float32Array(frames);
for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * HOP; i < (f + 1) * HOP; i++) s += x[i] * x[i]; e[f] = Math.log1p(s * 1e3); }
const o = new Float32Array(frames);
for (let f = 1; f < frames; f++) o[f] = Math.max(0, e[f] - e[f - 1]);
// smooth a little, remove the local mean
const w = 4;
const os = new Float32Array(frames);
for (let f = 0; f < frames; f++) { let s = 0, c = 0; for (let k = -w; k <= w; k++) if (f + k >= 0 && f + k < frames) { s += o[f + k]; c++; } os[f] = s / c; }
const mean = os.reduce((a, b) => a + b, 0) / frames;
for (let f = 0; f < frames; f++) os[f] = Math.max(0, os[f] - mean);
// tempo: the autocorrelation lag in 60–200 BPM with the highest score, scored with its double and half, nudged by the hint
const hopS = HOP / SR;
const minBpm = opt('min', 60), maxBpm = opt('max', 200), hint = opt('hint', 0);
const corr = (lag) => { let s = 0; for (let f = lag; f < frames; f++) s += os[f] * os[f - lag]; return s / (frames - lag); };
let best = { bpm: 120, score: -1 };
for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
  const lag = Math.round(60 / bpm / hopS);
  if (lag < 2 || lag * 2 >= frames) continue;
  let score = corr(lag) + 0.5 * corr(lag * 2) + (lag % 2 === 0 ? 0.25 * corr(lag / 2) : 0);
  if (hint) score *= 1 + 0.15 * Math.exp(-Math.pow(Math.log2(bpm / hint), 2) / 0.02);
  if (score > best.score) best = { bpm, score };
}
const bpm = best.bpm;
const period = 60 / bpm;
// phase: the offset in [0, period) whose grid lines sit on the most onset strength
let phase = 0, phaseScore = -1;
for (let p = 0; p < period; p += hopS) {
  let s = 0;
  for (let t = p; t < frames * hopS; t += period) { const f = Math.round(t / hopS); if (f < frames) s += os[f]; }
  if (s > phaseScore) { phaseScore = s; phase = p; }
}
const dur = frames * hopS;
const beatsAt = []; for (let t = phase; t < dur; t += period) beatsAt.push(Number(t.toFixed(3)));
// the downbeat: the beat phase (of four) with the strongest onsets
let down = 0, downScore = -1;
for (let k = 0; k < 4; k++) { let s = 0; for (let i = k; i < beatsAt.length; i += 4) { const f = Math.round(beatsAt[i] / hopS); if (f < frames) s += os[f]; } if (s > downScore) { downScore = s; down = k; } }
const downbeats = beatsAt.filter((_, i) => i % 4 === down);
// hits: the strongest onsets, for sound effects to sit on
const peaks = [];
const thr = Math.max(...os) * 0.35;
for (let f = 1; f < frames - 1; f++) if (os[f] > thr && os[f] >= os[f - 1] && os[f] >= os[f + 1]) { if (!peaks.length || f - peaks[peaks.length - 1] > 8) peaks.push(f); }
console.log(JSON.stringify({ bpm, period: Number(period.toFixed(4)), phase: Number(phase.toFixed(3)), duration: Number(dur.toFixed(2)), beats: beatsAt, downbeats, hits: peaks.map((f) => Number((f * hopS).toFixed(3))) }, null, 1));
