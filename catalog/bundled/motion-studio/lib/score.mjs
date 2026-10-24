#!/usr/bin/env node
// A music bed synthesised in code, on the film's own grid (ADR-0076): deterministic, no samples, no network.
//   node motion/lib/score.mjs --bpm 120 --dur 15 --out artifacts/motion/<film>/score.wav [--seed 7] [--key A] [--mood dark|warm|bright] [--drop 10] [--phase 0]
// Kick on every beat, hats on the off-beats, a bass root per bar, a pad chord per bar, a riser into the drop, a tail that fades.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const BPM = Number(opt('bpm', 120)), DUR = Number(opt('dur', 15)), SEED = Number(opt('seed', 7)), SR = 48000;
const out = opt('out', null); if (!out) { console.error('usage: score.mjs --bpm 120 --dur 15 --out score.wav [--seed] [--key] [--mood] [--drop] [--phase]'); process.exit(2); }
const KEY = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196.0, A: 220.0, B: 246.94 }[opt('key', 'A').toUpperCase()] ?? 220;
const MOOD = opt('mood', 'dark');
const DROP = Number(opt('drop', Math.round(DUR * 0.7)));
const PHASE = Number(opt('phase', 0));
const beat = 60 / BPM, bar = beat * 4;
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const n = Math.ceil(DUR * SR);
const buf = new Float32Array(n);
const tri = (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
const saw = (p) => 2 * (p - Math.floor(p + 0.5));
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));
// a chord progression per bar: i, VI, III, VII in a minor key reads dark; I, V, vi, IV warm; bright is major with a lift
const PROG = { dark: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], warm: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], bright: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]] }[MOOD] ?? [[0, 3, 7]];
const hz = (semi, oct = 0) => KEY * Math.pow(2, semi / 12 + oct);
const add = (start, len, fn, gain = 1) => { const a = Math.floor(start * SR), m = Math.min(n, a + Math.ceil(len * SR)); for (let i = a; i < m; i++) buf[i] += fn((i - a) / SR) * gain; };
const bars = Math.ceil(DUR / bar);
for (let b = 0; b < bars; b++) {
  const t0 = PHASE + b * bar, chord = PROG[b % PROG.length];
  // pad: three detuned saws through a slow envelope, quiet
  add(t0, bar, (t) => chord.reduce((acc, semi) => acc + saw(hz(semi, 1) * t) * 0.5 + saw(hz(semi, 1) * 1.003 * t) * 0.5, 0) * env(t, 0.2, bar) * 0.05);
  // bass: the root, an octave down, one note a bar with a pluck
  add(t0, bar * 0.95, (t) => Math.sin(2 * Math.PI * hz(chord[0], -1) * t) * env(t, 0.005, 0.5) * 0.35);
  for (let k = 0; k < 4; k++) {
    const tb = t0 + k * beat;
    if (tb >= DUR) break;
    // kick: a pitch drop with a fast decay
    add(tb, 0.3, (t) => Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12) * 0.9);
    // hat on the off-beat: short noise burst
    add(tb + beat / 2, 0.06, (t) => (rnd() * 2 - 1) * Math.exp(-t * 90) * 0.25);
    // an arp note on the beat, octave up, mood-dependent
    if (MOOD !== 'dark' || k % 2 === 0) add(tb, beat * 0.9, (t) => tri(hz(chord[(k + b) % chord.length], 2) * t) * env(t, 0.01, 0.12) * 0.12);
  }
}
// the riser into the drop: a noise sweep that rises for a bar, then the drop hits with a low thump
if (DROP > 1 && DROP < DUR) {
  add(DROP - bar, bar, (t) => (rnd() * 2 - 1) * (t / bar) * (t / bar) * 0.2);
  add(DROP, 0.6, (t) => Math.sin(2 * Math.PI * (45 + 50 * Math.exp(-t * 20)) * t) * Math.exp(-t * 5) * 1.0);
}
// the tail: the last 0.8 s fade, so the cut lands clean
for (let i = Math.max(0, n - Math.floor(0.8 * SR)); i < n; i++) buf[i] *= (n - i) / (0.8 * SR);
// soft clip and write 16-bit mono WAV
const b = Buffer.alloc(44 + n * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.tanh(buf[i]) * 32767), 44 + i * 2);
writeFileSync(out, b);
console.log(`wrote ${out}: ${DUR}s at ${BPM} BPM, ${MOOD}, key ${opt('key', 'A')}, drop at ${DROP}s`);
