#!/usr/bin/env node
// Render a film that is a pure function of time (ADR-0077): a headless Chromium opens the film's index.html, the page's
// window.seek(t) paints each moment, every frame is screenshotted and piped to ffmpeg, which blends SUB subframes per
// frame into motion blur and encodes H.264 yuv420p. Deterministic: the same film renders to the same bytes.
//
//   node motion/lib/render.mjs motion/<film> --out artifacts/motion/<film>/silent.mp4 [--fps 60] [--sub 4] [--format 16x9]
//                              [--from 0 --to 5]      a slice, for a re-render or a sample
//                              [--hash]               no encoding: print the sha1 of the frames instead (a determinism check)
//                              [--seam]               no encoding: how far the last frame is from the first (a loop check)
//
// Playwright comes from the repository when it has it, else from the Foundry that runs the goal (FOUNDRY_PLAYWRIGHT).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const film = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
if (!film) { console.error('usage: render.mjs <film dir> --out <mp4> [--fps 60] [--sub 4] [--format 16x9] [--from s --to s] [--hash] [--seam]'); process.exit(2); }

const dir = resolve(film);
const spec = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8'));
const format = opt('format', spec.formats?.[0] ?? '16x9');
const size = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] }[format];
if (!size) { console.error(`unknown format ${format}: use 16x9, 9x16, 1x1 or 4x5`); process.exit(2); }
const FPS = Number(opt('fps', spec.fps ?? 60));
const SUB = Math.max(1, Number(opt('sub', spec.subframes ?? 4)));
const DUR = Number(spec.duration);
const from = Number(opt('from', 0));
const to = Number(opt('to', DUR));
const out = opt('out', null);
const hashOnly = flag('hash');
const seamOnly = flag('seam');
if (!out && !hashOnly && !seamOnly) { console.error('--out <mp4> is required (or --hash / --seam)'); process.exit(2); }

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const base = process.env.FOUNDRY_PLAYWRIGHT;
    if (!base) throw new Error('playwright is not installed here and FOUNDRY_PLAYWRIGHT is not set: run `npm i -D playwright` in this repository, or run inside Foundry');
    return await import(pathToFileURL(join(base, 'index.mjs')).href).catch(() => import(pathToFileURL(join(base, 'index.js')).href));
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error(`page error: ${e.message}`); });
const url = `${pathToFileURL(join(dir, 'index.html')).href}?format=${format}&render=1`;
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
const ok = await page.evaluate(() => typeof window.seek === 'function');
if (!ok) { console.error('index.html defines no window.seek(t)'); await browser.close(); process.exit(1); }
const canvas = page.locator('#c');

const shot = async (t) => {
  await page.evaluate((t) => window.seek(t), t);
  return canvas.screenshot({ type: 'png' });
};

if (seamOnly) {
  const a = await shot(0);
  const b = await shot(Math.max(0, DUR - 1 / FPS));
  // a PNG compares badly byte for byte: compare the rendered pixels through the page instead
  const diff = await page.evaluate(async ([pa, pb]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    const w = ia.width, h = ia.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, w, h).data;
    g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, w, h).data;
    let sum = 0; for (let i = 0; i < A.length; i += 4) sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    return sum / (A.length / 4) / 3 / 255;
  }, [a.toString('base64'), b.toString('base64')]);
  console.log(JSON.stringify({ seam: Number(diff.toFixed(4)), ok: diff < 0.02 }));
  await browser.close();
  process.exit(diff < 0.02 ? 0 : 1);
}

const total = Math.round((to - from) * FPS * SUB);
let ff = null;
const hash = hashOnly ? createHash('sha1') : null;
if (!hashOnly) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  // tmix averages SUB consecutive subframes; select keeps the last of each group; setpts restamps to FPS
  const vf = SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB` : `setpts=N/${FPS}/TB`;
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-', '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', (e) => { console.error(`ffmpeg: ${e.message}`); process.exit(1); });
}
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const t = from + i / (FPS * SUB);
  const png = await shot(t);
  if (hash) hash.update(png);
  else if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  // a line every second of film: the session's idle watchdog and the person both see the render move
  if (i % (FPS * SUB) === 0 || i === total - 1) console.log(`rendered ${(t - from).toFixed(1)}s / ${(to - from).toFixed(1)}s (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
await browser.close();
if (hash) {
  console.log(JSON.stringify({ frames: total, sha1: hash.digest('hex'), from, to, fps: FPS, sub: SUB, format }));
} else {
  ff.stdin.end();
  const code = await new Promise((r) => ff.on('close', r));
  if (code !== 0) { console.error(`ffmpeg exited ${code}`); process.exit(1); }
  console.log(`wrote ${out}: ${(to - from).toFixed(2)}s at ${FPS} fps, ${size[0]}x${size[1]}`);
}
