/**
 * A throwaway Foundry with made-up goals in every state the user guide shows — no model is ever called: a scripted runner
 * answers every session. Used by scripts/screenshots.ts; also handy to click around the UI safely.
 *
 *   bun scripts/demo.ts            # serves http://127.0.0.1:4198 until Ctrl+C
 *
 * Its data and repository live in a temporary folder that is deleted on exit. Needs `bun run web:build` first.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
    { key: 'C1', name: 'build passes', tier: 'must', taskKey: null, areaKey: null, type: 'command', cmd: 'true', rubric: null },
    { key: 'C2', name: 'reads like the studio', tier: 'must', taskKey: null, areaKey: 'A1', type: 'reviewer', cmd: null, rubric: 'Copy is warm, short and specific to a small game studio.' },
    { key: 'C3', name: 'lighthouse accessibility ≥ 95', tier: 'stretch', taskKey: null, areaKey: null, type: 'reviewer', cmd: null, rubric: 'Landmarks, alt text, contrast.' },
  ],
  costEstimateUsd: 6,
  timeEstimateMin: 45,
  questions: [],
  styleOptions: [
    { key: 'S1', name: 'Arcade Night', palette: ['#0b0f1a', '#ff3d7f', '#35e0ff', '#f5f5f5'], fonts: ['Space Grotesk', 'Inter'], keywords: ['neon', 'playful', 'dark'], description: 'Dark background with neon accents, like a late-night arcade.' },
    { key: 'S2', name: 'Paper Studio', palette: ['#faf7f0', '#1f2937', '#e76f51', '#2a9d8f'], fonts: ['Fraunces', 'Inter'], keywords: ['warm', 'hand-made', 'light'], description: 'Warm paper tones and a serif headline, calm and crafted.' },
  ],
  run: { install: null, command: 'bun run start', url: 'http://localhost:{port}', platform: 'web' },
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
    checks: [{ key: 'C1', name: 'build passes', tier: 'must' as const, taskKey: null, areaKey: null, spec: { type: 'command' as const, cmd: 'true', timeoutMs: 60_000, expectExitCode: 0 } }],
    costEstimateUsd: o.costEstimateUsd,
    timeEstimateMin: o.timeEstimateMin,
    questions: [],
    styleOptions: [],
    run: o.run,
  };
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
    // a goal with an interview answers in the interview shape; one without gets the bare Brief
    else if (label.startsWith('clarify')) structuredOutput = spec.prompt.includes('dark mode') ? interviewRound : spec.prompt.includes('# Interview before the Brief') ? { questions: [], brief: landingBrief } : landingBrief;
    else if (label.startsWith('attempt')) {
      if (label.includes('games section') || label.includes('export button')) await new Promise((r) => setTimeout(r, 10 * 60_000));
      writeFileSync(join(spec.cwd, `${label.replace(/\W+/g, '-')}.txt`), 'demo');
    }
    const result: RunResult = { sessionId: `demo-${Math.random().toString(36).slice(2, 8)}`, subtype: 'success', isError: false, costUsd: 0.42, numTurns: 7, durationMs: 90_000, usage: null, modelUsage: null, permissionDenials: [], finalText: label.startsWith('attempt') ? 'Added the section and a test for it. The test passes locally; the page builds without warnings.' : 'done', structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [
      { kind: 'init', sessionId: result.sessionId!, model: 'claude-opus-5', tools: [], raw: {} },
      { kind: 'text', text: label.startsWith('attempt') ? 'Reading the layout and the existing components, then writing the section and its test.' : 'Exploring the repository…' },
      { kind: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/app/layout.tsx' } },
      { kind: 'result', result },
    ];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

async function makeRepo(dir: string): Promise<void> {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'studio-site', private: true, scripts: { start: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('<html><body style=\\"font-family:sans-serif;background:#0b0f1a;color:#f5f5f5;padding:4rem\\"><h1>Small studio. Big little games.</h1><p>We make light, creative mobile games.</p></body></html>', { headers: { 'content-type': 'text/html' } }) })"` } }, null, 2));
  writeFileSync(join(dir, 'README.md'), '# studio-site\n');
  await Bun.$`git -C ${dir} init -q -b main && git -C ${dir} -c user.name=demo -c user.email=demo@example.com add -A && git -C ${dir} -c user.name=demo -c user.email=demo@example.com commit -q -m init`.quiet();
}

const waitFor = async (pred: () => boolean, ms = 20_000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('demo: timed out waiting for a goal state');
    await Bun.sleep(50);
  }
};

/** start the demo; resolves once every seeded goal reached its state */
export async function startDemo(): Promise<{ url: string; goals: Record<string, string>; stop: () => Promise<void> }> {
  const tmp = mkdtempSync(join(tmpdir(), 'foundry-demo-'));
  const repo = join(tmp, 'studio-site');
  await Bun.$`mkdir -p ${repo}`.quiet();
  await makeRepo(repo);
  const engine = new Engine(defaultConfig(ROOT, { dataDir: join(tmp, 'data'), claudeHome: join(tmp, 'claude-home'), port: DEMO_PORT, alwaysReviewTasks: false, log: () => {} }), new DemoRunner());
  const server = startServer(engine, { webDist: join(ROOT, 'apps/web/dist') });
  const { getGoal, listEscalations } = await import('../packages/core/src/index.ts');
  const state = (id: string) => getGoal(engine.store.db, id)!.state;

  const interview = await engine.createGoal({ prompt: 'Add a dark mode toggle to the settings page', repoPath: repo, interview: 'always', workflow: { pace: 'fast' } });
  const brief = await engine.createGoal({ prompt: 'A landing page for our game studio', title: 'Studio landing page', repoPath: repo, interview: 'never', workflow: { pace: 'fast' } });
  const milestone = await engine.createGoal({ prompt: 'Studio site: hero and value cards', title: 'Studio site — first look', repoPath: repo, brief: briefFrom(landingBrief, landingBrief.tasks.slice(0, 3)) as never, workflow: { pace: 'fast' } });
  const running = await engine.createGoal({ prompt: 'Add CSV export to the orders page', title: 'CSV export for orders', repoPath: repo, brief: { ...briefFrom(landingBrief, [task('T1', 'add the export endpoint', [], { scenario: 'backend' }), task('T2', 'add the export button', ['T1']), task('T3', 'document the export in the help page', ['T2'], { scenario: 'docs', difficulty: 'simple' })]), title: 'feat(orders): export orders as CSV' } as never, workflow: { pace: 'fast' } });
  const blocked = await engine.createGoal({ prompt: 'impossible: make the flaky payment test pass', title: 'Fix the flaky payment test', repoPath: repo, budgets: { attemptsPerTask: 1 }, autoBrief: { mustChecks: ['test -f never.txt'] }, workflow: { pace: 'fast' } });

  await waitFor(() => getGoal(engine.store.db, interview.id)!.interview?.status === 'awaiting_answers');
  await waitFor(() => state(brief.id) === 'awaiting_brief_approval');
  await waitFor(() => state(milestone.id) === 'awaiting_feedback');
  await waitFor(() => listEscalations(engine.store.db, { goalId: blocked.id, openOnly: true }).length > 0);
  await waitFor(() => state(running.id) === 'running');
  return {
    url: `http://127.0.0.1:${DEMO_PORT}`,
    goals: { interview: interview.id, brief: brief.id, milestone: milestone.id, running: running.id, blocked: blocked.id },
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
