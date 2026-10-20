/**
 * Re-captures every screenshot of the user guide (docs/guide/images/*.png) from the seeded demo in scripts/demo.ts —
 * no model is called, so it is free and repeatable. Run before a release, after `bun run web:build`:
 *
 *   bun scripts/screenshots.ts
 *
 * Uses the system Chrome through Playwright (channel "chrome"); falls back to Playwright's own Chromium when installed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildTimeline, getGoal, type EngineEvent } from '@foundry/core';
import { addSubject, addSubjectPicture, subjectsDir } from '../packages/engine/src/subjects.ts';
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
    // a ready repository can report the host's global git identity
    for (const label of Array.from(document.querySelectorAll('span'))) {
      if (label.textContent === 'identity' && label.nextElementSibling) label.nextElementSibling.textContent = 'demo <you@example.com>';
    }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      n.textContent = (n.textContent ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'you@example.com').replace(/\/(?:private\/)?(?:var\/folders\/[^\s·]*?\/|tmp\/)foundry-demo-[^/\s]+\//g, '~/Projects/');
    }
  });
};
/** a simple drawing of the demo's mascot from one view: the guide's Subject pictures are drawn, never someone's photos */
const mascot = (view: 'front' | 'side' | 'three-quarter') => {
  const eye = view === 'side' ? '<circle cx="300" cy="150" r="26" fill="#0b0f1a"/>' : `<circle cx="${view === 'front' ? 240 : 262}" cy="150" r="42" fill="#f5f5f5"/><circle cx="${view === 'front' ? 240 : 270}" cy="150" r="20" fill="#0b0f1a"/>`;
  const body = view === 'side' ? '<rect x="205" y="215" width="70" height="95" rx="18" fill="#f97316"/>' : '<rect x="180" y="215" width="120" height="95" rx="22" fill="#f97316"/>';
  const arms = view === 'side' ? '<rect x="232" y="240" width="30" height="22" rx="10" fill="#fb923c"/>' : '<rect x="150" y="235" width="36" height="22" rx="10" fill="#fb923c"/><rect x="294" y="235" width="36" height="22" rx="10" fill="#fb923c"/>';
  return `<body style="margin:0;background:#1f2937"><svg width="480" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="360" fill="#1f2937"/><ellipse cx="240" cy="330" rx="120" ry="14" fill="#111827"/><line x1="240" y1="60" x2="240" y2="95" stroke="#e5e7eb" stroke-width="6"/><circle cx="240" cy="55" r="10" fill="#facc15"/>${view === 'side' ? '<ellipse cx="240" cy="150" rx="62" ry="58" fill="#e5e7eb"/>' : '<circle cx="240" cy="150" r="62" fill="#e5e7eb"/>'}${eye}${body}${arms}<text x="16" y="28" fill="#9ca3af" font-family="sans-serif" font-size="16">${view}</text></svg></body>`;
};
/**
 * The timeline of an afternoon's goal for the guide: a Brief that waited, tasks side by side, a review that sent one
 * back, a delegated goal doing the research, the goal review and the delivery.
 */
function demoTimeline(goalId: string, title: string) {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 13, 0, 0) + min * 60_000).toISOString();
  let n = 0;
  const ev = (g: string, min: number, type: string, payload: object) => ({ id: `e${++n}`, ts: at(min), goalId: g, type, payload }) as EngineEvent;
  const state = (g: string, min: number, from: string, to: string) => ev(g, min, 'goal.state_changed', { from, to, reason: '' });
  const usage = (g: string, min: number, kind: string, minutes: number, costUsd: number) => ev(g, min, 'session.usage', { sessionId: null, kind, model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd, durationMs: minutes * 60_000, subtype: 'success', rateLimit: null, skillsUsed: [] });
  /** a task's attempts: [work from, work to, review to, passed] each; then its landing */
  const task = (g: string, taskId: string, attempts: [number, number, number][], cost = 0.9) => {
    const out: EngineEvent[] = [];
    attempts.forEach(([from, to, reviewed], i) => {
      const id = `${taskId}-a${i + 1}`;
      out.push(ev(g, from, 'attempt.started', { attempt: { id, goalId: g, taskId, index: i + 1, kind: 'work', sessionId: null, state: 'running', startedAt: at(from), endedAt: null } }));
      out.push(ev(g, to, 'attempt.session_finished', { attemptId: id, session: { role: 'worker', segment: 0, sessionId: null, model: 'opus', costUsd: cost, numTurns: 30, durationMs: (to - from) * 60_000, subtype: 'success', startedAt: at(from), endedAt: at(to) } }));
      out.push(ev(g, reviewed, 'attempt.session_finished', { attemptId: id, session: { role: 'reviewer', segment: 0, sessionId: null, model: 'sonnet', costUsd: 0.2, numTurns: 8, durationMs: (reviewed - to) * 60_000, subtype: 'success', startedAt: at(to), endedAt: at(reviewed) } }));
      out.push(ev(g, reviewed, 'attempt.concluded', { attemptId: id, state: 'passed', reason: '' }));
    });
    const landed = attempts.at(-1)![2];
    out.push(ev(g, landed, 'merge.started', { taskId, into: 'goal' }), ev(g, landed + 1, 'merge.completed', { taskId, ref: 'x' }), ev(g, landed + 1, 'task.state_changed', { taskId, from: 'merging', to: 'done', reason: '' }));
    return out;
  };
  const child = 'g_demo_research';
  const main = {
    goal: { id: goalId, title, createdAt: at(0), state: 'over_delivered' as const },
    tasks: [
      { id: 'T1', title: 'add the subscribe endpoint', delegatedGoalId: null },
      { id: 'T2', title: "research what the studio's players want", delegatedGoalId: child },
      { id: 'T3', title: 'build the sign-up form in the footer', delegatedGoalId: null },
      { id: 'T4', title: 'validate emails and show friendly errors', delegatedGoalId: null },
      { id: 'T5', title: 'cover the sign-up flow with tests', delegatedGoalId: null },
    ],
    events: [
      state(goalId, 0, 'draft', 'clarifying'),
      usage(goalId, 5, 'clarify', 5, 1.8),
      usage(goalId, 7, 'planner', 2, 0.6),
      state(goalId, 7, 'clarifying', 'awaiting_brief_approval'),
      state(goalId, 15, 'awaiting_brief_approval', 'running'),
      ...task(goalId, 'T1', [[16, 28, 30]]),
      ev(goalId, 31, 'task.delegated', { taskId: 'T2', goalId: child, title: "research what the studio's players want" }),
      ...task(goalId, 'T3', [[31, 48, 50], [50, 60, 61]], 1.2),
      ...task(goalId, 'T4', [[31, 40, 41]], 0.5),
      usage(goalId, 63, 'walkthrough', 1, 0.1),
      ev(goalId, 70, 'task.state_changed', { taskId: 'T2', from: 'running', to: 'done', reason: '' }),
      ...task(goalId, 'T5', [[70, 82, 83]], 0.8),
      state(goalId, 85, 'running', 'goal_review'),
      usage(goalId, 96, 'review-goal', 11, 2.1),
      state(goalId, 96, 'goal_review', 'over_delivered'),
      ev(goalId, 97, 'delivery.started', { policy: {}, plan: [] }),
      ev(goalId, 103, 'delivery.completed', { outcome: {} }),
    ],
  };
  const research = {
    goal: { id: child, title: "research what the studio's players want", createdAt: at(31), state: 'done' as const },
    tasks: [
      { id: 'R1', title: 'survey three studio newsletters', delegatedGoalId: null },
      { id: 'R2', title: 'write the findings', delegatedGoalId: null },
    ],
    events: [state(child, 31, 'draft', 'clarifying'), usage(child, 36, 'clarify', 5, 1.1), state(child, 36, 'clarifying', 'running'), ...task(child, 'R1', [[37, 55, 57]], 1.4), ...task(child, 'R2', [[58, 66, 67]], 0.7), state(child, 69, 'running', 'done')],
  };
  return buildTimeline(main, [research], at(103));
}

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

/** one part of a page (a card), loaded and masked like a whole shot */
const partShot = async (name: string, path: string, part: () => ReturnType<typeof page.locator>) => {
  await page.goto('about:blank');
  await page.goto(demo.url + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await mask();
  await part().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await part().screenshot({ path: join(OUT, `${name}.png`) });
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
    await page.getByRole('button', { name: 'Expert', exact: false }).click();
    await page.locator('textarea').first().fill('Add CSV export to the orders page, with the date range the user is looking at.');
    const source = getGoal(demo.engine.store.db, g.blocked!);
    if (!source) throw new Error('New goal capture needs a seeded repository');
    const folder = page.getByPlaceholder('or type a path: /Users/you/projects/my-app');
    await folder.fill(source.repoPath);
    await folder.press('Enter');
    await page.getByText('Git repository', { exact: false }).waitFor();
    await page.getByText(`from the last goal in this folder: ${source.title}`, { exact: true }).waitFor();
    await page.getByText('Powered by', { exact: true }).evaluate((el) => el.parentElement?.scrollIntoView({ block: 'start' }));
  });
  await shot('interview', `/goals/${g.interview}`);
  await shot('brief', `/goals/${g.brief}/brief`);
  // the Brief skeleton while the planner works: editable, the Plan card showing the planner's progress
  await shot('brief-planning', `/goals/${g.planning}/brief`);
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
  // the demo's sessions end in milliseconds: the Timeline shows a goal of an afternoon instead, a delegated goal in it
  await page.route('**/api/goals/*/timeline', (r) => r.fulfill({ json: demoTimeline(g.done!, getGoal(demo.engine.store.db, g.done!)!.title) }));
  await page.setViewportSize({ width: 1280, height: 1180 });
  await shot('goal-timeline', `/goals/${g.done}#timeline`);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.unroute('**/api/goals/*/timeline');
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
  // a folder's Learnings, seeded here so the goal pages above show none (ADR-0040)
  const repoPath = getGoal(demo.engine.store.db, g.done!)!.repoPath;
  const learned = (kind: 'build' | 'test' | 'structure' | 'pitfall' | 'preference', text: string, by: 'foundry' | 'human' = 'foundry') => ({ id: `lrn_${kind}${by}`, kind, text, by, goalId: by === 'foundry' ? g.done! : null, goalTitle: by === 'foundry' ? title(g.done!) : null, at: ago(90) });
  demo.engine.store.append({
    type: 'learnings.set',
    goalId: null,
    payload: {
      repoPath,
      learnings: [
        learned('preference', 'Copy is in British English: "colour", "organise". Keep it that way in new text.', 'human'),
        learned('test', 'Run `bun test` from the repository root; the e2e tests need `bun run dev` on port 5173 first.'),
        learned('structure', 'Pages live in src/pages, shared parts in src/components; the footer is src/components/Footer.tsx.'),
        learned('pitfall', 'Email checks must accept addresses with a plus sign in the name: the first attempt rejected them.'),
        learned('build', 'Install with `bun install`; npm fails on the workspace protocol in package.json.'),
      ],
      source: 'distill',
      goalId: g.done!,
      note: null,
    },
  });
  // the person's everywhere notebook (ADR-0055): the first card on the page
  demo.engine.store.append({ type: 'learnings.set', goalId: null, payload: { repoPath: '*', learnings: [{ id: 'lrn_ev1', kind: 'preference', text: 'Use bun, never npm or yarn, in every project; commit messages in English, one short paragraph.', by: 'human', goalId: null, goalTitle: null, at: ago(90) }, { id: 'lrn_ev2', kind: 'convention', text: 'Reviewers reject any commit that adds a dependency without a note on why it is needed.', by: 'human', goalId: null, goalTitle: null, at: ago(90) }], source: 'human', goalId: null, note: null } });
  await shot('learnings', '/learnings', undefined, 640);
  // Schedules (ADR-0054): one saved from the New goal form, with a run behind it
  demo.engine.saveSchedule({
    name: 'Weekly dependency upgrade',
    cadence: { kind: 'weekly', weekday: 1, at: '03:00' },
    recipe: { prompt: 'Upgrade every dependency to its latest minor version, run the test suite, and note anything that needed a code change in the pull request.', repoPath: demo.engine.store.db ? (await (await fetch(`${demo.url}/api/goals/${g.done}`)).json()).goal.repoPath : '', budgetPreset: 'quick', delivery: { mode: 'pr' }, links: [] },
    autoApprove: true,
  });
  demo.engine.store.append({ type: 'schedule.fired', goalId: g.done!, payload: { scheduleId: demo.engine.listSchedules()[0]!.id, name: 'Weekly dependency upgrade', at: new Date(Date.now() - 2 * 86_400_000).toISOString(), skipped: null, late: false, manual: false } });
  await shot('schedules', '/schedules', undefined, 420);
  // Deploy (ADR-0041): the demo's site is not a web app the hosts take, so the card's facts are given here and one
  // live preview is recorded on the finished goal, after the shots above
  const deployed = demo.engine.store.append({ type: 'deploy.started', goalId: g.done!, payload: { provider: 'vercel', production: false, ref: 'a1b2c3d', framework: 'Vite', dir: '' } });
  demo.engine.store.append({ type: 'deploy.finished', goalId: g.done!, payload: { provider: 'vercel', production: false, url: 'https://studio-site-3f9a2c-preview.vercel.app' } });
  // its smoke (ADR-0058): the site's milestone scripts passed against the address
  const smoked = (script: string, summary: string) => ({ script, taskId: null, status: 'pass' as const, error: null, summary, clips: [], shots: [], outputs: [], log: null });
  demo.engine.store.append({ type: 'deploy.smoke_finished', goalId: g.done!, payload: { provider: 'vercel', production: false, url: 'https://studio-site-3f9a2c-preview.vercel.app', deployedAt: deployed.ts, status: 'pass', detail: '2 scripts passed against https://studio-site-3f9a2c-preview.vercel.app', scripts: [smoked('e2e/milestones/gallery.spec.ts', '2 tests: opens the gallery; opens a picture'), smoked('e2e/milestones/booking.spec.ts', '1 test: books a session')] } });
  await page.route('**/api/goals/*/deploy*', (r) =>
    r.fulfill({
      json: {
        app: { ok: true, app: { dir: '', framework: 'Vite', kind: 'built' }, notes: [] },
        finished: true,
        running: false,
        smoking: false,
        smoke: { scripts: ['e2e/milestones/gallery.spec.ts', 'e2e/milestones/booking.spec.ts'] },
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

  // Subjects: the studio's own mascot figure, from pictures of the person's (drawn here: the demo shows nobody's photos)
  const pictures: Uint8Array[] = [];
  // each drawing is cut from the top left of the page as it is: shrinking the window to it first sometimes caught a frame
  // not yet drawn again at the new size
  for (const view of ['front', 'side', 'three-quarter'] as const) {
    await page.setContent(mascot(view));
    pictures.push(new Uint8Array(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 480, height: 360 } })));
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  const pip = { name: 'Pip, our robot mascot (the vinyl figure)', lookFor: 'the round head with one big eye, the antenna, the orange body and the short arms' };
  addSubject(demo.engine, g.brief!, { ...pip, search: false });
  for (const [i, caption] of ['front', 'side', 'three-quarter'].entries()) addSubjectPicture(demo.engine, g.brief!, 'P1', pictures[i]!, caption);
  await partShot('subjects', `/goals/${g.brief}/brief`, () => page.locator('#brief-subjects'));
  // the first look at the landing page, compared with the same pictures
  const store = demo.engine.store;
  mkdirSync(subjectsDir(demo.engine.config.dataDir, g.milestone!), { recursive: true });
  for (const [i, bytes] of pictures.entries()) writeFileSync(join(subjectsDir(demo.engine.config.dataDir, g.milestone!), `P1-${i + 1}.png`), bytes);
  store.append({ type: 'brief.subject_set', goalId: g.milestone!, payload: { subject: { key: 'P1', ...pip } } });
  store.append({ type: 'brief.subject_pictures', goalId: g.milestone!, payload: { subjectKey: 'P1', added: ['front', 'side', 'three-quarter'].map((caption, i) => ({ file: `P1-${i + 1}.png`, source: 'person' as const, url: null, caption })), removed: [] } });
  const recording = store.listByGoalOfTypes(g.milestone!, ['milestone.evidence']).at(-1)!;
  store.append({
    type: 'milestone.likeness',
    goalId: g.milestone!,
    payload: {
      taskId: (recording.payload as { taskId: string }).taskId,
      evidenceAt: recording.ts,
      status: 'ok',
      verdict: { subjects: [{ key: 'P1', shown: true, score: 6, matches: ['the orange body', 'the antenna'], differences: [{ what: 'the eye is small and set low; in the pictures one big eye fills half the face', major: true }, { what: 'the arms are long; in the pictures they are short stubs', major: false }], shots: [] }], summary: 'Recognisably Pip, but the face reads as another robot.' },
      detail: '',
      costUsd: 0.31,
      fixTaskId: null,
    },
  });
  await partShot('likeness', `/goals/${g.milestone}`, () => page.locator('div.rounded-md', { hasText: 'Likeness to the pictures' }).first());
} finally {
  await browser.close();
  await demo.stop();
}
console.log(`wrote ${OUT}`);
process.exit(0);
