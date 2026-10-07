/**
 * A throwaway Foundry with made-up goals in every state the user guide shows — no model is ever called: a scripted runner
 * answers every session. Used by scripts/screenshots.ts; also handy to click around the UI safely.
 *
 *   bun scripts/demo.ts            # serves http://127.0.0.1:4198 until Ctrl+C
 *
 * Its data and repository live in a temporary folder that is deleted on exit. Needs `bun run web:build` first.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BriefOutput } from '../packages/core/src/index.ts';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '../packages/runner/src/index.ts';
import { defaultConfig } from '../packages/engine/src/config.ts';
import { Engine } from '../packages/engine/src/engine.ts';
import { startServer } from '../packages/server/src/index.ts';

const ROOT = resolve(import.meta.dir, '..');
export const DEMO_PORT = 4198;

const task = (key: string, title: string, deps: string[], extra: Partial<BriefOutput['tasks'][number]> = {}): BriefOutput['tasks'][number] => ({
  key, title, spec: `### What\n${title}.\n\n### Done when\nThe page renders and its test passes.`, kind: 'feature', scope: null, scenario: 'frontend', areaKey: 'A1', dependsOnKeys: deps, parallelizable: false, relevantFiles: [`src/${key.toLowerCase()}.ts`], milestone: null, difficulty: 'standard', ...extra,
});
const landingBrief: BriefOutput = {
  title: 'feat(site): build the studio landing page',
  understanding: 'Build an English landing page for a small mobile-game studio: a hero, three value cards, a games section with placeholder titles, and a contact strip linking to the studio email. It is a static site so it can be hosted anywhere.',
  nature: 'code',
  areas: [{ key: 'A1', name: 'Website', slug: 'site', description: 'The public landing page.' }],
  assumptions: ['Games are placeholders you replace later.', 'Contact is a mailto link, no form.'],
  tasks: [
    task('T1', 'scaffold the static site with a shared layout', [], { scenario: 'infra', difficulty: 'simple' }),
    task('T2', 'build the hero and value cards', ['T1'], { milestone: 'Open the preview and read the hero: does the headline sound like your studio?' }),
    task('T3', 'add the games section with placeholder cards', ['T2']),
    task('T4', 'wire the contact strip and page metadata', ['T3'], { difficulty: 'complex' }),
  ],
  checks: [
    { key: 'C1', name: 'build passes', tier: 'must', taskKey: null, areaKey: null, type: 'command', cmd: 'bun run build', rubric: null },
    { key: 'C2', name: 'reads like the studio', tier: 'must', taskKey: null, areaKey: 'A1', type: 'reviewer', cmd: null, rubric: 'Copy is warm, short and specific to a small game studio.' },
    { key: 'C3', name: 'lighthouse accessibility ≥ 95', tier: 'stretch', taskKey: null, areaKey: null, type: 'reviewer', cmd: null, rubric: 'Landmarks, alt text, contrast.' },
  ],
  costEstimateUsd: 6,
  timeEstimateMin: 45,
  openQuestions: [],
  styleOptions: [
    { key: 'S1', name: 'Arcade Night', palette: ['#0b0f1a', '#ff3d7f', '#35e0ff', '#f5f5f5'], fonts: ['Space Grotesk', 'Inter'], keywords: ['neon', 'playful', 'dark'], description: 'Dark background with neon accents, like a late-night arcade.' },
    { key: 'S2', name: 'Paper Studio', palette: ['#faf7f0', '#1f2937', '#e76f51', '#2a9d8f'], fonts: ['Fraunces', 'Inter'], keywords: ['warm', 'hand-made', 'light'], description: 'Warm paper tones and a serif headline, calm and crafted.' },
  ],
  run: { install: null, command: 'bun run start', url: 'http://localhost:{port}', platform: 'web' },
  apps: null,
};
const interviewRound = {
  questions: [
    { key: 'R1Q1', text: 'Should dark mode follow the operating system, or only switch when the user clicks the toggle?', options: ['Follow the system until the user picks one, then remember it', 'Only the toggle', 'Only the system setting'], reason: 'The settings page has a theme select but nothing reads the system preference (src/settings/Theme.tsx).', dependsOn: null, blocking: true },
    { key: 'R1Q2', text: 'Where should the choice be remembered?', options: ['In the browser (localStorage)', 'In the user account on the server'], reason: 'There is no user-preferences table yet; adding one is a bigger change.', dependsOn: null, blocking: false },
    { key: 'R1Q3', text: 'Do charts on the dashboard need dark colours too?', options: ['Yes, recolour them', 'No, leave them light for now'], reason: 'The dashboard charts hard-code light colours (src/dashboard/palette.ts).', dependsOn: null, blocking: false },
  ],
  brief: null,
};

/** an approved-shape Brief (what the engine stores) from a Clarifier-shape one, command checks only so no review session runs */
function briefFrom(o: BriefOutput, tasks: BriefOutput['tasks']) {
  return {
    title: o.title,
    understanding: o.understanding,
    areas: o.areas,
    assumptions: o.assumptions.map((text, i) => ({ id: `as${i}`, text, accepted: true, applied: false })),
    tasks: tasks.map((t) => ({ ...t, tdd: 'off' as const })),
    checks: [{ key: 'C1', name: 'build passes', tier: 'must' as const, taskKey: null, areaKey: null, spec: { type: 'command' as const, cmd: 'bun run build', timeoutMs: 60_000, expectExitCode: 0 } }],
    costEstimateUsd: o.costEstimateUsd,
    timeEstimateMin: o.timeEstimateMin,
    questions: [],
    styleOptions: [],
    run: o.run,
  };
}

/** the demo repository as it starts: a small site with a server, a footer and an orders page */
const REPO_FILES: Record<string, string> = {
  'src/server.ts': `import { Hono } from 'hono';
import { orders } from './orders/routes';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/orders', orders);

export default app;
`,
  'src/components/Footer.tsx': `export function Footer() {
  return (
    <footer className="site-footer">
      <p>Small studio. Big little games.</p>
      <a href="mailto:hello@studio.example">hello@studio.example</a>
    </footer>
  );
}
`,
  'src/pages/Orders.tsx': `import { DateRange } from '../components/DateRange';
import { OrdersTable } from '../components/OrdersTable';
import { useOrders } from '../orders/useOrders';

export function OrdersPage() {
  const { range, setRange, orders } = useOrders();
  return (
    <main>
      <header className="page-head">
        <h1>Orders</h1>
        <DateRange value={range} onChange={setRange} />
      </header>
      <OrdersTable rows={orders} />
    </main>
  );
}
`,
  'src/orders/routes.ts': `import { Hono } from 'hono';
import { listOrders } from './store';

export const orders = new Hono();

orders.get('/', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  return c.json(await listOrders({ from, to }));
});
`,
};

/** what a scripted task writes, by task title: whole files, or [old, new] replacements in an existing one */
const TASK_EDITS: Record<string, Record<string, string | [string, string][]>> = {
  'add the subscribe endpoint': {
    'src/api/subscribe.ts': `import { Hono } from 'hono';
import { isEmail } from '../lib/email';
import { subscribers } from '../db';

export const subscribe = new Hono();

/** POST /api/subscribe { email } — idempotent: subscribing twice is not an error */
subscribe.post('/', async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email || !isEmail(email)) return c.json({ error: 'Please enter a valid email address.' }, 400);
  await subscribers.upsert({ email: email.trim().toLowerCase(), subscribedAt: new Date() });
  return c.json({ ok: true });
});
`,
    'src/server.ts': [
      ["import { orders } from './orders/routes';", "import { orders } from './orders/routes';\nimport { subscribe } from './api/subscribe';"],
      ["app.route('/orders', orders);", "app.route('/orders', orders);\napp.route('/api/subscribe', subscribe);"],
    ],
  },
  'validate emails and show friendly errors': {
    'src/lib/email.ts': `const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

/** Good enough for a sign-up form; the confirmation email is the real check. */
export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** The message shown under the field, or null when the address looks fine. */
export function emailError(value: string): string | null {
  if (!value.trim()) return 'Enter your email to get studio news.';
  if (!isEmail(value)) return 'That does not look like an email address.';
  return null;
}
`,
  },
  'build the sign-up form in the footer': {
    // an image the task made: the card shared when someone posts the sign-up link
    'public/newsletter-card.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0f1a"/><stop offset="1" stop-color="#2b1055"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1010" cy="130" r="190" fill="#ff3d7f" opacity=".35"/>
  <circle cx="1100" cy="520" r="120" fill="#35e0ff" opacity=".3"/>
  <text x="80" y="250" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#f5f5f5">Get new games first</text>
  <text x="80" y="330" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="#c9c9d6">One email a month from a small studio. No spam.</text>
  <rect x="80" y="400" width="300" height="76" rx="38" fill="#ff3d7f"/>
  <text x="230" y="449" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#0b0f1a">Subscribe</text>
</svg>
`,
    'src/components/Footer.tsx': [
      ['export function Footer() {\n  return (', `import { useState } from 'react';
import { emailError } from '../lib/email';

export function Footer() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const error = state === 'idle' && email ? emailError(email) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailError(email)) return;
    setState('sending');
    await fetch('/api/subscribe', { method: 'POST', body: JSON.stringify({ email }) });
    setState('done');
  };
  return (`],
      ['      <p>Small studio. Big little games.</p>', `      <p className="tagline">Small studio. Big little games.</p>
      {state === 'done' ? (
        <p role="status">Thanks! Check your inbox to confirm.</p>
      ) : (
        <form onSubmit={submit} className="newsletter">
          <label htmlFor="nl-email">Get new games first</label>
          <input id="nl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
          <button disabled={state === 'sending'}>Subscribe</button>
          {error && <small className="error">{error}</small>}
        </form>
      )}`],
    ],
  },
  'cover the sign-up flow with tests': {
    'tests/subscribe.test.ts': `import { describe, expect, test } from 'bun:test';
import app from '../src/server';
import { emailError, isEmail } from '../src/lib/email';

describe('newsletter sign-up', () => {
  test('accepts a real address, twice', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/api/subscribe', { method: 'POST', body: JSON.stringify({ email: 'Ada@Example.com ' }) });
      expect(res.status).toBe(200);
    }
  });

  test('rejects a typo with a friendly message', async () => {
    const res = await app.request('/api/subscribe', { method: 'POST', body: JSON.stringify({ email: 'ada@example' }) });
    expect(res.status).toBe(400);
    expect(emailError('ada@example')).toBe('That does not look like an email address.');
  });

  test('isEmail ignores surrounding spaces', () => {
    expect(isEmail('  ada@example.com ')).toBe(true);
  });
});
`,
  },
  'add the export endpoint': {
    'src/orders/export.ts': `import type { Order } from './store';

const COLUMNS = ['id', 'date', 'customer', 'items', 'total'] as const;

/** RFC 4180: quote a field when it holds a comma, a quote or a line break */
const field = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\\n]/.test(s) ? \`"\${s.replaceAll('"', '""')}"\` : s;
};

export function toCsv(rows: Order[]): string {
  const lines = rows.map((o) => [o.id, o.date.slice(0, 10), o.customer, o.items.length, o.total.toFixed(2)].map(field).join(','));
  return [COLUMNS.join(','), ...lines].join('\\r\\n');
}
`,
    'src/orders/routes.ts': [
      ["import { listOrders } from './store';", "import { listOrders } from './store';\nimport { toCsv } from './export';"],
      ['  return c.json(await listOrders({ from, to }));\n});', `  return c.json(await listOrders({ from, to }));
});

// the same date range the page shows, as a download
orders.get('/export.csv', async (c) => {
  const rows = await listOrders({ from: c.req.query('from'), to: c.req.query('to') });
  c.header('content-disposition', \`attachment; filename="orders-\${c.req.query('from') ?? 'all'}.csv"\`);
  return c.body(toCsv(rows), 200, { 'content-type': 'text/csv; charset=utf-8' });
});`],
    ],
  },
  'add the export button': {
    'src/pages/Orders.tsx': [
      ['        <DateRange value={range} onChange={setRange} />', `        <DateRange value={range} onChange={setRange} />
        <a className="button" href={\`/orders/export.csv?from=\${range.from}&to=\${range.to}\`} download>
          Download CSV
        </a>`],
    ],
  },
  'stream large exports in chunks': {
    'src/orders/csv-stream.ts': `import { listOrdersPage } from './store';
import { toCsv } from './export';

/** Pages through the orders so a year of data never sits in memory at once. */
export function csvStream(range: { from?: string; to?: string }, pageSize = 500): ReadableStream<string> {
  let cursor: string | null = null;
  let first = true;
  return new ReadableStream({
    async pull(ctrl) {
      const page = await listOrdersPage({ ...range, cursor, limit: pageSize });
      const csv = toCsv(page.rows);
      ctrl.enqueue(first ? csv : csv.slice(csv.indexOf('\\n') + 1));
      first = false;
      cursor = page.next;
      if (!cursor) ctrl.close();
    },
  });
}
`,
  },
};

function applyEdits(cwd: string, title: string): boolean {
  const edits = TASK_EDITS[title];
  if (!edits) return false;
  for (const [file, edit] of Object.entries(edits)) {
    const path = join(cwd, file);
    mkdirSync(dirname(path), { recursive: true });
    if (typeof edit === 'string') writeFileSync(path, edit);
    else writeFileSync(path, edit.reduce((text, [from, to]) => text.replace(from, to), readFileSync(path, 'utf8')));
  }
  return true;
}

/** a worker session as the live log shows it: reading, editing, running the tests */
function workerEvents(title: string, sessionId: string, result: RunResult, cwd: string): RunnerEvent[] {
  const files = Object.keys(TASK_EDITS[title] ?? { 'src/app/layout.tsx': '' });
  return [
    { kind: 'hook', name: 'SessionStart:startup', outcome: 'success' },
    { kind: 'init', sessionId, model: 'claude-opus-5', tools: [], raw: {} },
    { kind: 'thinking', text: `The task: ${title}. Read the code around it first, then make the smallest change that passes the checks.` },
    { kind: 'text', text: 'Reading the existing code and its tests before changing anything.' },
    { kind: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'app.route|export function', path: 'src' } },
    { kind: 'tool_result', toolUseId: 't1', isError: false, content: "src/server.ts:7: app.route('/orders', orders);\nsrc/components/Footer.tsx:1: export function Footer() {" },
    ...files.flatMap((f, i): RunnerEvent[] => [
      { kind: 'tool_use', id: `e${i}`, name: f in REPO_FILES ? 'Edit' : 'Write', input: { file_path: join(cwd, f) } },
      { kind: 'tool_result', toolUseId: `e${i}`, isError: false, content: `The file ${join(cwd, f)} has been updated.` },
    ]),
    { kind: 'tool_use', id: 't2', name: 'Bash', input: { command: 'bun test', description: 'Run the test suite' } },
    { kind: 'tool_result', toolUseId: 't2', isError: false, content: 'bun test v1.2.20\n\n 14 pass\n 0 fail\n 31 expect() calls\nRan 14 tests across 5 files. [412ms]' },
    { kind: 'result', result },
  ];
}

/** the session as Claude Code's stream-json transcript, so the Live log can read it back after the page loads */
function writeTranscript(path: string | undefined, events: RunnerEvent[]): void {
  if (!path) return;
  const lines = events.flatMap((e): object[] => {
    if (e.kind === 'init') return [{ type: 'system', subtype: 'init', session_id: e.sessionId, model: e.model, tools: [] }];
    if (e.kind === 'thinking') return [{ type: 'assistant', message: { content: [{ type: 'thinking', thinking: e.text }] } }];
    if (e.kind === 'text') return [{ type: 'assistant', message: { content: [{ type: 'text', text: e.text }] } }];
    if (e.kind === 'tool_use') return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: e.id, name: e.name, input: e.input }] } }];
    if (e.kind === 'tool_result') return [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: e.toolUseId, is_error: e.isError, content: e.content }] } }];
    if (e.kind === 'result') return [{ type: 'result', subtype: e.result.subtype, is_error: false, result: e.result.finalText, session_id: e.result.sessionId, total_cost_usd: e.result.costUsd, num_turns: e.result.numTurns }];
    return [];
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

/** answers every session from a script; `slow` sessions wait so a goal can be caught while it runs */
class DemoRunner implements ClaudeRunner {
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    const label = spec.label ?? '';
    let structuredOutput: unknown = null;
    if (label.startsWith('classify nature')) structuredOutput = { nature: 'code' };
    else if (label.startsWith('planner ')) structuredOutput = { tasks: landingBrief.tasks };
    else if (label.startsWith('milestone walkthrough')) structuredOutput = { steps: [{ action: 'shot', target: '', role: null, value: '', caption: 'The hero, as a visitor first sees it' }, { action: 'press', target: '', role: null, value: 'End', caption: '' }, { action: 'shot', target: '', role: null, value: '', caption: 'The value cards further down' }], summary: 'Opens the site and scrolls from the hero to the value cards.' };
    // a goal with an interview answers in the interview shape; one without gets the bare Brief
    else if (label.startsWith('clarify')) structuredOutput = spec.prompt.includes('dark mode') ? interviewRound : spec.prompt.includes('# Interview before the Brief') ? { questions: [], brief: landingBrief } : landingBrief;
    const title = label.startsWith('attempt') ? label.slice('attempt '.length).replace(/ #\d+.*$/, '') : '';
    const sessionId = `demo-${Math.random().toString(36).slice(2, 8)}`;
    if (title) {
      if (title.includes('games section') || title.includes('export button')) {
        // still working: the log so far, up to the test run, then a wait the demo never sees the end of
        writeTranscript(spec.transcriptPath, workerEvents(title, sessionId, {} as RunResult, spec.cwd).slice(0, -2));
        await new Promise((r) => setTimeout(r, 10 * 60_000));
      }
      if (!applyEdits(spec.cwd, title)) writeFileSync(join(spec.cwd, `${label.replace(/\W+/g, '-')}.txt`), 'demo');
    }
    const result: RunResult = { sessionId, subtype: 'success', isError: false, costUsd: 0.42, numTurns: 7, durationMs: 90_000, usage: null, modelUsage: null, permissionDenials: [], finalText: title ? `Done: ${title}. The change is in place with its tests; bun test passes (14 tests) and the build is clean.` : 'done', structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = title ? workerEvents(title, result.sessionId!, result, spec.cwd) : [
      { kind: 'hook', name: 'SessionStart:startup', outcome: 'success' },
      { kind: 'init', sessionId: result.sessionId!, model: spec.model ?? null, tools: [], raw: {} },
      { kind: 'text', text: label.startsWith('attempt') ? 'Reading the layout and the existing components, then writing the section and its test.' : 'Exploring the repository…' },
      { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/app/layout.tsx' } },
      { kind: 'result', result },
    ];
    if (title) writeTranscript(spec.transcriptPath, events);
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

async function makeRepo(dir: string): Promise<void> {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'studio-site', private: true, scripts: { build: 'echo built', test: 'echo 14 pass', typecheck: 'echo ok', lint: 'echo clean', start: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('<html><body style=\\"font-family:sans-serif;background:#0b0f1a;color:#f5f5f5;padding:4rem\\"><h1>Small studio. Big little games.</h1><p>We make light, creative mobile games.</p></body></html>', { headers: { 'content-type': 'text/html' } }) })"` } }, null, 2));
  writeFileSync(join(dir, 'README.md'), '# studio-site\n');
  for (const [file, text] of Object.entries(REPO_FILES)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  await Bun.$`git -C ${dir} init -q -b main && git -C ${dir} -c user.name=demo -c user.email=demo@example.com add -A && git -C ${dir} -c user.name=demo -c user.email=demo@example.com commit -q -m init`.quiet();
}

const waitFor = async (pred: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('demo: timed out waiting for a goal state');
    await Bun.sleep(50);
  }
};

/** command checks only (they pass at once, no review session); named like the checks a real Brief carries */
const DEMO_CHECKS = [
  { key: 'C1', name: 'build passes', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'bun run build', timeoutMs: 60_000, expectExitCode: 0 } },
  { key: 'C2', name: 'tests pass', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'bun run test', timeoutMs: 60_000, expectExitCode: 0 } },
  { key: 'C3', name: 'no type errors', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'bun run typecheck', timeoutMs: 60_000, expectExitCode: 0 } },
  { key: 'C4', name: 'lint is clean', tier: 'stretch', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'bun run lint', timeoutMs: 60_000, expectExitCode: 0 } },
];

/**
 * What the finished goal's Overview shows beside the delivery: the project skills autoskills matched to its stack, and
 * the completion actions (docs written and committed, a graph refresh with one tool failing so Re-run shows).
 */
function recordCompletionExtras(engine: Engine, goalId: string): void {
  const rec = (type: string, payload: object) => engine.store.append({ type, goalId, payload } as never);
  rec('goal.autoskills', { status: 'installed', skills: ['accessibility', 'frontend-design', 'next-best-practices', 'nodejs-best-practices', 'react-best-practices', 'seo', 'tailwind-css-patterns', 'typescript-advanced-types', 'vitest', 'zod'], detail: 'matched package.json' });
  rec('goal.completion_set', { graphRefresh: true, docs: ['to-prd', 'readme-update'], reason: 'inferred: coding goal' });
  rec('goal.docs_generated', { status: 'ok', types: ['to-prd', 'readme-update'], files: ['docs/prd/newsletter-sign-up.md', 'README.md'], costUsd: 0.21, detail: 'committed 9c4e1a7 (2 file(s))', ref: '9c4e1a7d2b8f6e0c3a5d7b9e1f2a4c6d8e0b1a3c' });
  rec('goal.completion_ran', {
    tools: [
      { name: 'pull', status: 'ok', detail: 'main fast-forwarded to the merged commit' },
      { name: 'graphify', status: 'failed', detail: 'graphify update . exited 1: no Python 3.10+ interpreter found' },
      { name: 'gitnexus', status: 'ok', detail: 'analyze in 14s' },
    ],
  });
}

/**
 * The finished goal's delivery as the Delivery tab shows it after "one PR per task, merge when green": the demo has no
 * GitHub, so the events a real delivery records are written directly — every PR opened, green and merged.
 */
async function recordMergedDelivery(engine: Engine, goalId: string): Promise<void> {
  const { DeliveryPolicy, getGoal, listTasks } = await import('../packages/core/src/index.ts');
  const goal = getGoal(engine.store.db, goalId)!;
  const policy = DeliveryPolicy.parse({ mode: 'pr-automerge', unit: 'task' });
  const tasks = listTasks(engine.store.db, goalId).filter((t) => t.origin === 'brief');
  // a PR is titled like the task's commit, as the real delivery does
  const headerOf = (t: (typeof tasks)[number]) => (t.commitMessage ?? t.title).split('\n')[0]!;
  const stack = tasks.map((t, i) => ({ taskId: t.id, index: i + 1, branch: `${goal.branch}/${i + 1}`, base: i === 0 ? goal.baseBranch : `${goal.branch}/${i}`, commit: (t.commitRef ?? '0000000').slice(0, 7), title: headerOf(t) }));
  const url = (n: number) => `https://github.com/example/studio-site/pull/${n}`;
  const rec = (type: string, payload: object) => engine.store.append({ type, goalId, payload } as never);
  const step = (s: string, status: string, detail: string) => rec('delivery.step', { step: s, status, detail });
  const cmd = (s: string, command: string, outputTail = '') => rec('delivery.command', { step: s, command, cwd: goal.repoPath, exitCode: 0, durationMs: 800 + command.length * 9, outputTail });
  rec('delivery.policy_set', { policy, source: 'deliver' });
  rec('delivery.started', { policy, plan: ['preflight', 'sync-base', 'build-stack', 'push', 'open-pr', 'wait-checks', 'merge', 'cleanup'] });
  step('preflight', 'ok', 'working tree clean · 4 tasks done · gh signed in');
  step('sync-base', 'ok', `${goal.baseBranch} has not moved since the goal started`);
  step('build-stack', 'ok', '4 branches, one per task, each on top of the one before');
  rec('delivery.stack_built', { branches: stack });
  for (const b of stack) {
    cmd('push', `git push -u origin ${b.branch}`);
    rec('delivery.pushed', { remote: 'origin', branch: b.branch, ref: b.commit, taskId: b.taskId });
  }
  step('push', 'ok', '4 branches → origin');
  for (const b of stack) {
    cmd('open-pr', `gh pr create --base ${b.base} --head ${b.branch} --title "${b.title}"`, url(40 + b.index));
    rec('delivery.pr_opened', { number: 40 + b.index, url: url(40 + b.index), base: b.base, head: b.branch, taskId: b.taskId, title: b.title });
  }
  step('open-pr', 'ok', '4 pull requests, stacked');
  for (const b of stack) rec('delivery.checks', { state: 'passing', summary: 'build ✓ · test ✓ · lint ✓', prNumber: 40 + b.index, failing: [] });
  step('wait-checks', 'ok', 'CI green on all 4');
  for (const b of stack) {
    // after the PR below is squash-merged, each next branch replays its own commit onto main (ADR-0023)
    rec('delivery.synced', { branch: b.branch, how: b.index === 1 ? 'current' : 'rebased', from: null, to: null });
    cmd('merge', `gh pr merge ${40 + b.index} --squash`);
    rec('delivery.merged', { prNumber: 40 + b.index, method: 'squash', ref: b.commit, taskId: b.taskId });
    cmd('cleanup', `git push origin --delete refs/heads/${b.branch}`);
    rec('delivery.branch_deleted', { branch: b.branch });
  }
  step('merge', 'ok', '4 merged into main (squash), in order');
  rec('delivery.completed', { outcome: 'merged' });
  rec('delivery.local_synced', { upToDate: true, detail: `your local ${goal.baseBranch} was fast-forwarded` });
  step('cleanup', 'ok', 'remote branches deleted · progress folder and worktrees removed');
  rec('delivery.cleaned', { done: true, detail: 'progress folder, worktrees and local goal branches removed' });
}

/** start the demo; resolves once every seeded goal reached its state */
export async function startDemo(): Promise<{ url: string; goals: Record<string, string>; engine: Engine; stop: () => Promise<void> }> {
  const tmp = mkdtempSync(join(tmpdir(), 'foundry-demo-'));
  const repo = join(tmp, 'studio-site');
  await Bun.$`mkdir -p ${repo}`.quiet();
  await makeRepo(repo);
  const engine = new Engine(defaultConfig(ROOT, { provider: 'claude', dataDir: join(tmp, 'data'), claudeHome: join(tmp, 'claude-home'), codexHome: join(tmp, 'codex-home'), port: DEMO_PORT, alwaysReviewTasks: false, autoskills: false, log: () => {} }), new DemoRunner());
  // Keep shared Codex skills isolated as well as its native home.
  const skills = engine.skillsForProvider('codex');
  skills.paths.agentsSkillsDir = join(tmp, '.agents', 'skills');
  skills.paths.agentsLock = join(tmp, '.agents', '.skill-lock.json');
  // the completion's graph refresh reports graphify and gitnexus as run, without touching this machine's tools
  engine.graphRefreshDeps = { which: (n) => `/usr/local/bin/${n}`, exec: async () => ({ code: 0, stdout: '', stderr: '' }) as never };
  const server = startServer(engine, { webDist: join(ROOT, 'apps/web/dist') });
  const { getGoal, listEscalations } = await import('../packages/core/src/index.ts');
  const state = (id: string) => getGoal(engine.store.db, id)!.state;

  // a finished goal first: it can be followed (Continue with a follow-up…), and its delivery is shown merged
  const newsletterTasks = [
    task('T1', 'add the subscribe endpoint', [], { scenario: 'backend', relevantFiles: ['src/server.ts'] }),
    task('T2', 'build the sign-up form in the footer', ['T1'], { parallelizable: true, relevantFiles: ['src/components/Footer.tsx'] }),
    task('T3', 'validate emails and show friendly errors', ['T1'], { parallelizable: true, difficulty: 'simple' }),
    task('T4', 'cover the sign-up flow with tests', ['T2', 'T3'], { kind: 'chore', scenario: 'backend' }),
  ];
  const done = await engine.createGoal({
    prompt: 'Add a newsletter sign-up to the site footer: an email field, a friendly error for typos, and the address stored for our monthly studio news.',
    title: 'Newsletter sign-up in the footer',
    repoPath: repo,
    brief: { ...briefFrom(landingBrief, newsletterTasks), title: 'feat(site): newsletter sign-up in the footer', understanding: 'Add an email sign-up to the footer of every page. The address is validated in the browser and on the server, stored once (subscribing twice is fine), and the visitor sees a thank-you. No emails are sent by this change.', checks: DEMO_CHECKS } as never,
    workflow: { pace: 'fast' },
  });
  // the stretch check passes too, so it ends over-delivered
  await waitFor(() => ['done', 'over_delivered'].includes(state(done.id)));
  await recordMergedDelivery(engine, done.id);
  recordCompletionExtras(engine, done.id);
  const interview = await engine.createGoal({ prompt: 'Add a dark mode toggle to the settings page', repoPath: repo, interview: 'always', workflow: { pace: 'fast' } });
  const brief = await engine.createGoal({ prompt: 'A landing page for our game studio', title: 'Studio landing page', provider: 'codex', repoPath: repo, interview: 'never', workflow: { pace: 'fast' } });
  const milestone = await engine.createGoal({ prompt: 'Studio site: hero and value cards', title: 'Studio site — first look', repoPath: repo, brief: briefFrom(landingBrief, landingBrief.tasks.slice(0, 3)) as never, workflow: { pace: 'fast' } });
  const running = await engine.createGoal({
    prompt: 'Add CSV export to the orders page, with the date range the user is looking at.',
    title: 'CSV export for orders',
    repoPath: repo,
    brief: {
      ...briefFrom(landingBrief, [
        task('T1', 'add the export endpoint', [], { scenario: 'backend', relevantFiles: ['src/orders/routes.ts'] }),
        task('T2', 'add the export button', ['T1'], { parallelizable: true }),
        task('T3', 'stream large exports in chunks', ['T1'], { scenario: 'backend', parallelizable: true, difficulty: 'complex' }),
        task('T4', 'document the export in the help page', ['T2', 'T3'], { scenario: 'docs', difficulty: 'simple' }),
      ]),
      title: 'feat(orders): export orders as CSV',
      understanding: 'A "Download CSV" button on the orders page exports exactly the orders in the date range on screen. Large ranges stream page by page so the server never holds a year of orders in memory.',
      checks: DEMO_CHECKS,
    } as never,
    workflow: { pace: 'fast' },
  });
  const blocked = await engine.createGoal({ prompt: 'impossible: make the flaky payment test pass', title: 'Fix the flaky payment test', repoPath: repo, budgets: { attemptsPerTask: 1 }, autoBrief: { mustChecks: ['test -f never.txt'] }, workflow: { pace: 'fast' } });

  await waitFor(() => getGoal(engine.store.db, interview.id)!.interview?.status === 'awaiting_answers');
  await waitFor(() => state(brief.id) === 'awaiting_brief_approval');
  await waitFor(() => state(milestone.id) === 'awaiting_feedback');
  await waitFor(() => listEscalations(engine.store.db, { goalId: blocked.id, openOnly: true }).length > 0);
  await waitFor(() => state(running.id) === 'running');
  // the graph shows one task done, two side by side (one still running) and one waiting
  const { listTasks } = await import('../packages/core/src/index.ts');
  await waitFor(() => listTasks(engine.store.db, running.id).find((t) => t.title.startsWith('stream'))?.state === 'done');
  return {
    url: `http://127.0.0.1:${DEMO_PORT}`,
    goals: { done: done.id, interview: interview.id, brief: brief.id, milestone: milestone.id, running: running.id, blocked: blocked.id },
    // for QA scripts that need to record an event the scripted sessions never produce (e.g. a merged delivery)
    engine,
    stop: async () => {
      server.stop(true);
      await engine.stop().catch(() => {});
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

if (import.meta.main) {
  const d = await startDemo();
  console.log(`demo Foundry at ${d.url} — Ctrl+C to stop`);
  for (const [k, id] of Object.entries(d.goals)) console.log(`  ${k.padEnd(10)} ${d.url}/goals/${id}`);
  process.on('SIGINT', () => void d.stop().then(() => process.exit(0)));
}
