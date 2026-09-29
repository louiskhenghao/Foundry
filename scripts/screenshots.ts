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
// the MiniMax card reports whether this machine has mmx and a key: the guide shows the page without it
await page.route('**/api/usage/minimax*', (r) => r.fulfill({ json: { state: 'unavailable', reason: 'no-cli', checkedAt: new Date().toISOString() } }));
const mask = async () => {
  // the header shows the signed-in account and live usage of whoever runs this script: never ship those in a screenshot
  await page.evaluate(() => {
    // the dot on the ⚙ menu reports this machine's missing tools, not the demo's
    document.querySelector('button[aria-label="Settings, setup, help and theme"] span.bg-rose-500')?.remove();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      n.textContent = (n.textContent ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'you@example.com').replace(/\/(?:private\/)?var\/folders\/[^\s·]*?\/foundry-demo-[^/\s]+\//g, '~/Projects/');
    }
  });
};
const shot = async (name: string, path: string, prepare?: () => Promise<void>, height?: number) => {
  // a fresh load each time: a dialog left open by the shot before would otherwise cover this one (same page, new hash)
  await page.goto('about:blank');
  await page.goto(demo.url + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await mask();
  if (prepare) await prepare();
  // again: dialogs and logs opened by `prepare` show paths too
  await mask();
  await page.screenshot({ path: join(OUT, `${name}.png`), clip: height ? { x: 0, y: 0, width: 1280, height } : undefined });
  console.log(`  ${name}.png`);
};

try {
  const g = demo.goals;
  // the README's first picture: every goal of the demo, one in each state. The Setup banner reports this machine's
  // missing tools, not the demo's, and the empty page below the list is cut off.
  await shot('goals', '/', async () => {
    await page.evaluate(() => Array.from(document.querySelectorAll('div')).find((d) => d.textContent?.startsWith('Setup incomplete') && d.parentElement?.textContent !== d.textContent)?.remove());
  }, 560);
  await shot('new-goal', '/goals/new', async () => {
    await page.locator('textarea').first().fill('Add CSV export to the orders page, with the date range the user is looking at.');
  });
  await shot('interview', `/goals/${g.interview}`);
  await shot('brief', `/goals/${g.brief}/brief`);
  await shot('goal-running', `/goals/${g.running}`);
  // one picture per tab of the goal page: the finished goal (delivered as four merged PRs) and the running one
  await shot('goal-overview', `/goals/${g.done}#overview`);
  await shot('goal-tasks', `/goals/${g.running}#tasks`, undefined, 520);
  await shot('task-drawer', `/goals/${g.running}#tasks`, async () => {
    await page.getByText('add the export endpoint', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Live log' }).click();
    await page.waitForTimeout(800);
  });
  // a file the task made, opened from the task's Files without an editor
  await shot('file-preview', `/goals/${g.done}#tasks`, async () => {
    await page.getByText('build the sign-up form in the footer', { exact: true }).first().click();
    await page.locator('img[alt="public/newsletter-card.svg"]').click();
    await page.waitForTimeout(800);
  });
  await shot('goal-activity', `/goals/${g.done}#activity`, async () => {
    await page.getByLabel('important only').check();
    await page.waitForTimeout(300);
  });
  await shot('goal-diff', `/goals/${g.done}#diff`);
  await shot('goal-delivery', `/goals/${g.done}#delivery`);
  // last on this goal: the view choice is remembered per goal
  await shot('goal-simple', `/goals/${g.running}`, async () => {
    await page.getByRole('button', { name: 'Simple view' }).click();
    await page.waitForTimeout(500);
  });
  await shot('milestone', `/goals/${g.milestone}`);
  // the guide's caption names Suggest a hint and Retry with hint: bring the retries item's buttons into the frame
  await shot('inbox', '/inbox', async () => {
    await page.getByRole('button', { name: 'Retry with hint' }).first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 24));
    await page.waitForTimeout(300);
  });
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
