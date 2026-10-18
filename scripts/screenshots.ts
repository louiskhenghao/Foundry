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
import { getGoal } from '@foundry/core';
import { seedImportedGoal, startDemo } from './demo.ts';

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
    await page.getByRole('radio', { name: 'Simple' }).click();
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
  // Agents reads this machine's own Claude Code and Codex history: the guide shows demonstration sessions instead
  const title = (id: string) => getGoal(demo.engine.store.db, id)?.title ?? null;
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const session = (s: Record<string, unknown>) => ({ sessionId: crypto.randomUUID(), provider: 'claude', source: 'external', entrypoint: 'cli', status: 'finished', pid: null, model: 'claude-opus-5-5', title: null, cwd: '/Users/you/Projects/studio-site', gitBranch: 'main', startedAt: ago(40), endedAt: null, lastActivityAt: ago(2), contextUsedTokens: 182_000, contextWindowTokens: 1_000_000, version: null, subagents: [], foundry: null, ...s });
  const sessions = [
    session({ source: 'foundry', entrypoint: 'foundry', status: 'busy', title: 'add the export endpoint', cwd: null, foundry: { goalId: g.running, goalTitle: title(g.running!), taskId: null, taskTitle: 'add the export endpoint', attemptId: null, kind: 'work', attempt: 1, killable: true }, subagents: [{ agentId: 'a1', agentType: 'Explore', description: 'Find the orders routes and their tests', status: 'done', lastActivityAt: ago(6), model: 'claude-haiku-5-5', startedAt: ago(9), contextUsedTokens: 41_000, contextWindowTokens: 200_000 }] }),
    session({ source: 'foundry', entrypoint: 'foundry', status: 'finished', provider: 'codex', model: 'gpt-6.1', title: 'build the sign-up form in the footer', cwd: null, contextUsedTokens: null, contextWindowTokens: null, foundry: { goalId: g.done, goalTitle: title(g.done!), taskId: null, taskTitle: 'build the sign-up form in the footer', attemptId: null, kind: 'work', attempt: 2, killable: false }, lastActivityAt: ago(55), endedAt: ago(55) }),
    session({ status: 'idle', title: 'Review the account settings flow', entrypoint: 'claude-vscode' }),
    session({ provider: 'codex', status: 'unknown', model: 'gpt-6.1', title: 'Explore the newsletter design', cwd: '/Users/you/Projects/newsletter', contextUsedTokens: null, contextWindowTokens: null, lastActivityAt: ago(30) }),
  ];
  await page.route('**/api/agents', (r) => r.fulfill({ json: { sessions, summary: { busy: 1, idle: 1, finished: 1, unknown: 1, total: 4 }, generatedAt: new Date().toISOString() } }));
  await shot('agents', '/agents');
  await page.unroute('**/api/agents');
  await shot('transfer', '/transfer', undefined, 760);
  // Deploy (ADR-0041): the demo's site is not a web app the hosts take, so the card's facts are given here and one
  // live preview is recorded on the finished goal, after the shots above
  demo.engine.store.append({ type: 'deploy.started', goalId: g.done!, payload: { provider: 'vercel', production: false, ref: 'a1b2c3d', framework: 'Vite', dir: '' } });
  demo.engine.store.append({ type: 'deploy.finished', goalId: g.done!, payload: { provider: 'vercel', production: false, url: 'https://studio-site-3f9a2c-preview.vercel.app' } });
  await page.route('**/api/goals/*/deploy*', (r) =>
    r.fulfill({
      json: {
        app: { ok: true, app: { dir: '', framework: 'Vite', kind: 'built' }, notes: [] },
        finished: true,
        running: false,
        providers: [
          { id: 'vercel', label: 'Vercel', configured: true, refused: null },
          { id: 'netlify', label: 'Netlify', configured: true, refused: null },
          { id: 'cloudflare', label: 'Cloudflare Pages', configured: false, refused: null },
        ],
        plan: [{ label: 'deploy to Vercel', command: 'npx --yes vercel@64 deploy --yes' }],
        deployments: [],
      },
    }),
  );
  // the card alone: it is the last thing on the tab, and the delivery card above it names this machine's GitHub account
  await page.goto('about:blank');
  await page.goto(`${demo.url}/goals/${g.done}#delivery`, { waitUntil: 'networkidle' });
  await page.locator('#deploy').waitFor();
  await page.waitForTimeout(600);
  await mask();
  await page.locator('#deploy').screenshot({ path: join(OUT, 'deploy.png') });
  console.log('  deploy.png');
  await page.unroute('**/api/goals/*/deploy*');
  // seeded last: the shots above count the demo's goals
  const imported = await seedImportedGoal(demo.engine, g.done!);
  await shot('goal-imported', `/goals/${imported}`, undefined, 620);
} finally {
  await browser.close();
  await demo.stop();
}
console.log(`wrote ${OUT}`);
process.exit(0);
