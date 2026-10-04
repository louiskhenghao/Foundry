import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const main = resolve(import.meta.dir, 'main.ts');
const prefill = {
  provider: 'codex', repoPath: '/tmp/foundry-cli-fixture', modelPreset: 'saved-codex-preset', effort: null,
  nature: 'research', pace: 'fast', mode: 'normal', delivery: { mode: 'local', remote: 'origin' },
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
