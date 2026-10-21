import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const main = resolve(import.meta.dir, 'main.ts');
const prefill = {
  provider: 'codex', repoPath: '/tmp/foundry-cli-fixture', modelPreset: 'saved-codex-preset', effort: null,
  nature: 'research', pace: 'fast', mode: 'normal', delivery: { mode: 'local', remote: 'origin' },
  profile: 'plain', tdd: 'preferred', ponytail: 'off',
};

async function submittedGoal(flags: string[] = [], inherited: Record<string, unknown> | null = prefill) {
  let submitted: Record<string, any> | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/goals/prior/follow-up-draft') return Response.json({ followable: true, prefill: inherited });
      if (path === '/api/goals' && request.method === 'POST') {
        submitted = await request.json();
        return Response.json({ id: 'next', title: 'Follow-up', state: 'draft' });
      }
      return new Response('Unexpected request', { status: 404 });
    },
  });
  try {
    const child = Bun.spawn([process.execPath, main, 'goal', 'new', 'Continue the work', ...(inherited ? ['--follows', 'prior'] : ['--repo', prefill.repoPath]), ...flags], {
      env: { FOUNDRY_URL: `http://127.0.0.1:${server.port}`, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(submitted).toBeDefined();
    return submitted!;
  } finally {
    server.stop(true);
  }
}

describe('CLI goal creation defaults', () => {
  test('web-only Follow-up workflow fields do not change CLI creation or explicit workflow flags', async () => {
    const body = await submittedGoal();
    expect(body.workflow).toEqual({ pace: 'fast' });
    expect(body.mode).toBe('normal');
    expect(body.delivery).toEqual({ mode: 'local', remote: 'origin', createRepo: null, remoteUrl: null });
    expect(body.follows).toEqual({ goalId: 'prior', attachments: true, style: true });
    expect((await submittedGoal(['--pace', 'thorough', '--suite', 'pstack'])).workflow).toEqual({ pace: 'thorough', profile: 'pstack' });
  });

  test('Codex follow-ups preserve their preset and explicit null effort without a model override', async () => {
    const body = await submittedGoal();
    expect(body.modelPreset).toBe('saved-codex-preset');
    expect(body.effort).toBeNull();
    expect(body).not.toHaveProperty('codexModel');
    expect(body.provider).toBe('codex');
    expect(body.nature).toBe('research');
    expect(body.follows.goalId).toBe('prior');
  });

  test('explicit flags replace inherited Codex model settings', async () => {
    const body = await submittedGoal(['--models', 'chosen', '--effort', 'ultra', '--codex-model', 'chosen-model']);
    expect(body.modelPreset).toBe('chosen');
    expect(body.effort).toBe('ultra');
    expect(body.codexModel).toBe('chosen-model');
  });

  test('default explicitly clears inherited effort while native none remains a reasoning value', async () => {
    const inherited = { ...prefill, effort: 'high' };
    expect((await submittedGoal(['--effort', 'default'], inherited)).effort).toBeNull();
    expect((await submittedGoal(['--effort', 'none'], inherited)).effort).toBe('none');
  });

  test('legacy Codex models are inherited unless the user chooses a per-role preset', async () => {
    const inherited = { ...prefill, modelPreset: null, codexModel: 'legacy-model', effort: 'xhigh' };
    expect((await submittedGoal([], inherited)).codexModel).toBe('legacy-model');
    const selected = await submittedGoal(['--models', 'production'], inherited);
    expect(selected.modelPreset).toBe('production');
    expect(selected).not.toHaveProperty('codexModel');
    expect(selected.effort).toBe('xhigh');
  });

  test('Claude follow-ups still inherit presets and effort', async () => {
    const body = await submittedGoal([], { ...prefill, provider: 'claude', modelPreset: 'economy', effort: 'medium' });
    expect(body.modelPreset).toBe('economy');
    expect(body.effort).toBe('medium');
  });

  test('new goals omit unspecified effort but send null for an explicit default', async () => {
    expect(await submittedGoal([], null)).not.toHaveProperty('effort');
    expect((await submittedGoal(['--provider', 'codex', '--effort', 'default'], null)).effort).toBeNull();
  });
});

describe('a goal from a GitHub issue (ADR-0052)', () => {
  const read = {
    issue: { repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/issues/7', title: 'Export orders as CSV', state: 'open', labels: [], readAt: '2026-10-20T00:00:00Z' },
    title: 'Export orders as CSV',
    prompt: 'The orders page needs a CSV export.',
    attachment: { id: 'att_7', kind: 'link', name: 'acme/app#7', mime: null, size: null, path: null, url: 'https://github.com/acme/app/issues/7', note: null, addedAt: '2026-10-20T00:00:00Z', markdown: null },
  };
  async function fromIssue(args: string[]) {
    let asked: Record<string, any> | undefined;
    let submitted: Record<string, any> | undefined;
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/api/issues/read') {
          asked = await request.json();
          return Response.json(read);
        }
        if (path === '/api/goals' && request.method === 'POST') {
          submitted = await request.json();
          return Response.json({ id: 'g_1', title: submitted!.title, state: 'draft', issue: read.issue });
        }
        return new Response('Unexpected request', { status: 404 });
      },
    });
    try {
      const child = Bun.spawn([process.execPath, main, 'goal', 'new', ...args], { env: { FOUNDRY_URL: `http://127.0.0.1:${server.port}`, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      return { asked, submitted, stdout };
    } finally {
      server.stop(true);
    }
  }

  test('--issue reads the issue first: its title and body stand in for the prompt, its thread is attached', async () => {
    const { asked, submitted, stdout } = await fromIssue(['--issue', 'acme/app#7', '--repo', '/tmp/foundry-cli-fixture']);
    expect(asked).toEqual({ ref: 'acme/app#7', repoPath: '/tmp/foundry-cli-fixture' });
    expect(submitted).toMatchObject({ prompt: read.prompt, title: read.title, issue: read.issue, attachments: [read.attachment] });
    expect(stdout).toContain('from issue acme/app#7 (https://github.com/acme/app/issues/7); its pull request closes it');
  });

  test('a prompt and a title given on the command line win over the issue’s', async () => {
    const { submitted } = await fromIssue(['Own words', '--issue', 'https://github.com/acme/app/issues/7', '--title', 'Own title', '--repo', '/tmp/foundry-cli-fixture']);
    expect(submitted).toMatchObject({ prompt: 'Own words', title: 'Own title', issue: read.issue });
  });
});

describe('schedules (ADR-0054)', () => {
  async function cli(args: string[], handle: (path: string, method: string) => Response | null) {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => handle(new URL(request.url).pathname, request.method) ?? new Response('Unexpected request', { status: 404 }) });
    try {
      const child = Bun.spawn([process.execPath, main, 'schedules', ...args], { env: { FOUNDRY_URL: `http://127.0.0.1:${server.port}`, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { exitCode, stdout, stderr };
    } finally {
      server.stop(true);
    }
  }
  const row = { id: 'sch_1', name: 'Weekly upgrade', enabled: true, nextRunAt: '2026-10-26T03:00:00.000Z', lastRun: { at: '2026-10-19T03:00:00.000Z', goalId: 'g_1', skipped: null }, lastGoal: { id: 'g_1', title: 'Weekly upgrade · 2026-10-19', state: 'done' }, runs: 1 };
  test('schedules lists each one with its next and last run; schedules run fires one', async () => {
    const list = await cli([], (path, method) => (path === '/api/schedules' && method === 'GET' ? Response.json({ schedules: [row] }) : null));
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('sch_1');
    expect(list.stdout).toContain('Weekly upgrade');
    expect(list.stdout).toContain('last: done g_1');
    const run = await cli(['run', 'sch_1'], (path, method) => (path === '/api/schedules/sch_1/run' && method === 'POST' ? Response.json({ goalId: 'g_2', skipped: null }) : null));
    expect(run.stdout).toContain('started goal g_2');
    const skipped = await cli(['run', 'sch_1'], (path) => (path === '/api/schedules/sch_1/run' ? Response.json({ goalId: null, skipped: 'the previous run is still going' }) : null));
    expect(skipped.stdout).toContain('skipped: the previous run is still going');
  });
});

describe('CLI report (ADR-0060)', () => {
  test('report prints the window, the retries, the estimates, the projects and the session kinds the server reports', async () => {
    const spend = { sessions: 12, costUsd: 18.5, unmeasured: 1, codexSessions: 0, durationMs: 3_600_000 };
    const retries = { tasks: 10, retried: 2, attempts: 13, fixTasks: 1, rate: 0.2 };
    const estimate = { cost: { factor: 1.4, samples: 3, spread: 'tight' }, time: null, samples: 3 };
    const fixture = {
      now: '2026-10-21T12:00:00Z', window: { days: 90, from: '2026-07-23T12:00:00Z', to: '2026-10-21T12:00:00Z' }, step: 'week',
      totals: { ...spend, goals: { total: 4, finished: 3, failed: 1, cancelled: 0, open: 0 }, activeMin: 150, retries, estimate, noGoal: { sessions: 0, costUsd: 0, unmeasured: 0, codexSessions: 0, durationMs: 0 } },
      series: [], repos: [{ repoPath: '/x/alpha', name: 'alpha', ...spend, goals: { total: 4, finished: 3, failed: 1, cancelled: 0, open: 0 }, activeMin: 150, costPerFinishedGoal: 6.17, retries, estimate }],
      kinds: [{ kind: 'attempt', sessions: 10, costUsd: 16, unmeasured: 1, codexSessions: 0, durationMs: 3_000_000, costShare: 0.86, timeShare: 0.83 }], misses: [], note: 'From the sessions Foundry started on this machine.',
    };
    let asked = '';
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch(request) {
        const u = new URL(request.url);
        asked = u.pathname + u.search;
        return Response.json(fixture);
      },
    });
    try {
      const child = Bun.spawn([process.execPath, main, 'report', '--days', '90'], { env: { FOUNDRY_URL: `http://127.0.0.1:${server.port}`, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(asked).toBe('/api/reports?days=90');
      expect(stdout).toContain('Last 90 days: $18.50 (Claude Code)  12 sessions  3/4 goals finished (1 failed, 0 cancelled)  2.5 h worked');
      expect(stdout).toContain('retries: 20% of 10 tasks needed more than one attempt; 1 fix tasks');
      expect(stdout).toContain('estimates: cost ×1.4, time — (actual ÷ estimate over 3 goals with one)');
      expect(stdout).toContain('  alpha: $18.50  3/4 finished  2.5 h  retries 20%  estimate ×1.4/—');
      expect(stdout).toContain('by kind: attempt 86% of $ · 83% of time');
      expect(stdout).toContain(fixture.note);
    } finally {
      server.stop(true);
    }
  });
});
