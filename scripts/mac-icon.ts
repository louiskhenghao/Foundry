#!/usr/bin/env bun
/**
 * The macOS app's icon (ADR-0105): apps/web/public/favicon.svg drawn at 1024 px with the inset and shadow a macOS icon
 * has (an 824 px body on a 1024 canvas), scaled to every size an .icns holds with sips, packed with iconutil into
 * apps/mac/Foundry.icns. Run it again when the logo changes; the build only copies the file.
 *
 *   bun scripts/mac-icon.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPlaywright } from '../packages/engine/src/playwright-load.ts';

const ROOT = resolve(import.meta.dir, '..');
const svg = readFileSync(join(ROOT, 'apps/web/public/favicon.svg'), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'foundry-icon-'));
const set = join(work, 'Foundry.iconset');
mkdirSync(set);
const big = join(work, 'icon-1024.png');

const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:1024px;height:1024px;display:flex;align-items:center;justify-content:center">
      <div style="width:824px;height:824px;filter:drop-shadow(0 12px 18px rgba(0,0,0,.28))">${svg.replace('<svg ', '<svg width="824" height="824" ')}</div>
    </div></body></html>`);
  await page.screenshot({ path: big, omitBackground: true });
} finally {
  await browser.close();
}

const sizes: [string, number][] = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32], ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256], ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];
for (const [name, px] of sizes) {
  const p = Bun.spawnSync(['sips', '-z', String(px), String(px), big, '--out', join(set, name)], { stdout: 'ignore', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`sips ${name}: ${p.stderr.toString()}`);
}
const out = join(ROOT, 'apps/mac/Foundry.icns');
const r = Bun.spawnSync(['iconutil', '-c', 'icns', set, '-o', out], { stderr: 'pipe' });
if (r.exitCode !== 0) throw new Error(`iconutil: ${r.stderr.toString()}`);
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out}`);
