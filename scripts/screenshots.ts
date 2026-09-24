/**
 * Re-captures every screenshot of the user guide (docs/guide/images/*.png) from the seeded demo in scripts/demo.ts —
 * no model is called, so it is free and repeatable. Run before a release, after `bun run web:build`:
 *
 *   bun scripts/screenshots.ts
 *
 * Uses the system Chrome through Playwright (channel "chrome"); falls back to Playwright's own Chromium when installed.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startDemo } from './demo.ts';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, 'docs/guide/images');
// playwright is a dependency of the engine package; resolve it from there
const { chromium } = (await import(Bun.resolveSync('playwright', join(ROOT, 'packages/engine')))) as typeof import('../packages/engine/node_modules/playwright');

const demo = await startDemo();
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
mkdirSync(OUT, { recursive: true });
const shot = async (name: string, path: string, prepare?: () => Promise<void>) => {
  await page.goto(demo.url + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  // the header shows the signed-in account and live usage of whoever runs this script: never ship those in a screenshot
  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      n.textContent = (n.textContent ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'you@example.com').replace(/\/(?:private\/)?var\/folders\/[^\s·]*?\/foundry-demo-[^/\s]+\//g, '~/Projects/');
    }
  });
  if (prepare) await prepare();
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
};

try {
  const g = demo.goals;
  await shot('new-goal', '/goals/new', async () => {
    await page.locator('textarea').first().fill('Add CSV export to the orders page, with the date range the user is looking at.');
  });
  await shot('interview', `/goals/${g.interview}`);
  await shot('brief', `/goals/${g.brief}/brief`);
  await shot('goal-running', `/goals/${g.running}`);
  await shot('milestone', `/goals/${g.milestone}`);
  await shot('inbox', '/inbox');
  await shot('settings-models', '/settings', async () => {
    await page.evaluate(() => document.getElementById('models')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  });
  await shot('usage', '/usage');
} finally {
  await browser.close();
  await demo.stop();
}
console.log(`wrote ${OUT}`);
process.exit(0);
