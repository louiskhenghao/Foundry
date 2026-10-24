#!/usr/bin/env node
// Lay a film out in the repository (ADR-0076):
//   node <skill>/scripts/scaffold.mjs <film-slug> [--title "..."] [--dur 15] [--fps 60] [--formats 16x9,9x16] [--bpm 120]
// writes motion/lib/ (the renderer, the motion helpers, the sound, sheet and verify scripts, copied from this skill),
// motion/<slug>/{film.json, film.js, index.html, STORYBOARD.md} and artifacts/motion/<slug>/.
//   node <skill>/scripts/scaffold.mjs <film-slug> --sync      rewrites film.js from film.json after you edit it
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error('usage: scaffold.mjs <film-slug> [--title] [--dur] [--fps] [--formats] [--bpm] [--sync]'); process.exit(2); }

const root = process.cwd();
const lib = join(root, 'motion', 'lib');
const film = join(root, 'motion', slug);
const out = join(root, 'artifacts', 'motion', slug);
const spec = join(film, 'film.json');

const syncJs = () => {
  const json = JSON.parse(readFileSync(spec, 'utf8'));
  writeFileSync(join(film, 'film.js'), `// generated from film.json by scaffold.mjs --sync: edit film.json, not this file\nwindow.FILM = ${JSON.stringify(json, null, 2)};\n`);
};

if (args.includes('--sync')) {
  if (!existsSync(spec)) { console.error(`${spec} is missing`); process.exit(1); }
  syncJs();
  console.log(`film.js rewritten from ${spec}`);
  process.exit(0);
}

mkdirSync(lib, { recursive: true });
for (const f of ['motion.js', 'render.mjs', 'sheets.mjs', 'beats.mjs', 'score.mjs', 'sfx.mjs', 'mix.mjs', 'verify.mjs']) {
  const src = join(skill, 'lib', f);
  if (existsSync(src)) cpSync(src, join(lib, f));
}
mkdirSync(film, { recursive: true });
mkdirSync(out, { recursive: true });
mkdirSync(join(root, 'docs', 'motion'), { recursive: true });
if (!existsSync(spec)) {
  const json = JSON.parse(readFileSync(join(skill, 'templates', 'film.json'), 'utf8'));
  json.title = opt('title', slug);
  json.duration = Number(opt('dur', json.duration));
  json.fps = Number(opt('fps', json.fps));
  json.formats = opt('formats', json.formats.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  json.bpm = Number(opt('bpm', json.bpm));
  writeFileSync(spec, JSON.stringify(json, null, 2) + '\n');
}
syncJs();
if (!existsSync(join(film, 'index.html'))) writeFileSync(join(film, 'index.html'), readFileSync(join(skill, 'templates', 'index.html'), 'utf8').replace(/FILM TITLE/g, opt('title', slug)));
if (!existsSync(join(film, 'STORYBOARD.md'))) writeFileSync(join(film, 'STORYBOARD.md'), readFileSync(join(skill, 'templates', 'STORYBOARD.md'), 'utf8').replace(/FILM TITLE/g, opt('title', slug)));
console.log(`motion/${slug}/ laid out (film.json, film.js, index.html, STORYBOARD.md); motion/lib/ copied; artifacts/motion/${slug}/ ready`);
console.log(`preview: open motion/${slug}/index.html in a browser · render: node motion/lib/render.mjs motion/${slug} --out artifacts/motion/${slug}/silent.mp4`);
