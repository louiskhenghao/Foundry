#!/usr/bin/env node
// Sound effects on cue, synthesised (ADR-0077): node motion/lib/sfx.mjs cues.json --out sfx.wav [--dur 15]
// cues.json: [{"t": 0.5, "type": "click"}, {"t": 2.0, "type": "whoosh"}, ...]   types: click, pop, thump, whoosh, tick, rise
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const out = opt('out', null);
if (!file || !out) { console.error('usage: sfx.mjs cues.json --out sfx.wav [--dur 15]'); process.exit(2); }
const SR = 48000;
const cues = JSON.parse(readFileSync(file, 'utf8'));
const DUR = Number(opt('dur', Math.max(...cues.map((c) => c.t)) + 2));
let s = 42; const noise = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2147483648 - 1;
const VOICES = {
  click: [0.05, (t) => Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 90) * 0.5],
  tick: [0.03, (t) => Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 160) * 0.35],
  pop: [0.15, (t) => Math.sin(2 * Math.PI * (600 + 900 * t) * t) * Math.exp(-t * 30) * 0.4],
  thump: [0.5, (t) => Math.sin(2 * Math.PI * (90 - 60 * t) * t) * Math.exp(-t * 9) * 0.9],
  whoosh: [0.35, (t) => noise() * Math.sin(Math.PI * Math.min(1, t / 0.35)) * 0.25],
  rise: [1.0, (t) => noise() * t * t * 0.2],
};
const n = Math.ceil(DUR * SR);
const buf = new Float32Array(n);
for (const c of cues) {
  const v = VOICES[c.type]; if (!v) { console.error(`unknown cue type ${c.type}`); process.exit(2); }
  const [len, fn] = v, start = Math.floor(c.t * SR), gain = c.gain ?? 1;
  for (let i = 0; i < len * SR && start + i < n; i++) buf[start + i] += fn(i / SR) * gain;
}
const b = Buffer.alloc(44 + n * 2);
b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i])) * 32767), 44 + i * 2);
writeFileSync(out, b);
console.log(`wrote ${out}: ${cues.length} cues over ${DUR}s`);
