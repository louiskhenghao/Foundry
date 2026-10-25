import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { makeRepo, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const json = { 'content-type': 'application/json' };

/** a runner that answers each session with what the test says, and remembers what it was asked */
class StubRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  killed = 0;
  maxConcurrent = 3;
  constructor(private answer: (spec: RunSpec) => Partial<RunResult> | Promise<Partial<RunResult>>) {}
  active() {
    return 0;
  }
  setMaxConcurrent(n: number) {
    this.maxConcurrent = n;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const over = await this.answer(spec);
    const result: RunResult = {
      sessionId: `stub-${this.calls.length}`,
      subtype: 'success',
      isError: false,
      costUsd: 0.02,
      numTurns: 1,
      durationMs: 5,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: null,
      permissionDenials: [],
      finalText: '',
      structuredOutput: null,
      exitCode: 0,
      pid: null,
      rateLimit: null,
      errorMessage: null,
      skillsUsed: [],
      toolsUsed: {},
      ...over,
    };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: spec.model ?? 'stub', tools: [], raw: {} }, { kind: 'result', result }];
    return {
      pid: null,
      events: (async function* () {
        for (const e of events) yield e;
      })(),
      kill: () => {
        this.killed++;
      },
      result: Promise.resolve(result),
    };
  }
}

function start(home: string, runner: ClaudeRunner) {
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), runner);
  const app = createApp(engine);
  const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  const settled = async (id: string) => {
    let last: any;
    await waitFor(async () => {
      last = await (await app.request(`/api/templates/draft/${id}`)).json();
      return last.status !== 'running';
    });
    return last;
  };
  return { engine, app, send, settled };
}

test('a draft fills the chosen template from the notes on the housekeeping model, in one turn, without tools; the cost goes to the ledger without a goal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-draft-fill-'));
  const runner = new StubRunner(() => ({ structuredOutput: { values: { product: 'Foundry', duration: '30 s', message: 'A goal in, a pull request out.', brand: '', url: 'https://example.test', formats: '16:9 and 9:16', music: 'a score made on the beat', stray: 'x' } } }));
  const { engine, send, settled } = start(home, runner);
  try {
    const asked = await send('POST', '/api/templates/draft', { provider: 'claude', notes: 'A 30 second film about Foundry, which turns a goal into a pull request. Site: https://example.test', template: { id: 'video-product-reel' } });
    expect(asked.status).toBe(202);
    const { id } = await asked.json();
    const done = await settled(id);
    expect(done.status).toBe('done');
    expect(done.result.values).toEqual({ product: 'Foundry', duration: '30 s', message: 'A goal in, a pull request out.', brand: '', url: 'https://example.test', formats: '16:9 and 9:16', music: 'a score made on the beat' });
    expect(done.result.prompt).toBeNull();
    expect(done.result).toMatchObject({ costUsd: 0.02, costAvailable: true, model: 'haiku' });
    // one turn, no tools, the notes and the template in the prompt, the usage recorded with no goal
    const spec = runner.calls[0]!;
    expect(spec.maxTurns).toBe(1);
    expect(spec.allowedTools).toEqual([]);
    expect(spec.lane).toBe('aside');
    expect(spec.meta).toEqual({ tier: 'template', provider: 'claude' });
    expect(spec.prompt).toContain('The template "Product reel"');
    expect(spec.prompt).toContain('- product (The product) — Its name and what it does, in a line. — required');
    expect(spec.prompt).toContain('one of: 15 s | 30 s | 45 s | 60 s');
    expect(spec.prompt).toContain('Write in English.');
    expect(spec.prompt).toContain('turns a goal into a pull request');
    expect(spec.jsonSchema).toMatchObject({ properties: { values: expect.anything() } });
    const usage = engine.store.db.query("SELECT goal_id, kind, model FROM usage_ledger WHERE kind = 'template'").all() as { goal_id: string | null; kind: string; model: string }[];
    expect(usage).toEqual([{ goal_id: null, kind: 'template', model: 'haiku' }]);
    // the 中文 version of the template asks for 中文
    const zh = await send('POST', '/api/templates/draft', { notes: '三十秒的产品短片', template: { id: 'video-product-reel' }, lang: 'zh' });
    await settled((await zh.json()).id);
    expect(runner.calls[1]!.prompt).toContain('Write in 中文');
    expect(runner.calls[1]!.prompt).toContain('产品 reel');
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('with no template a description is written in the shape of the kind\'s built-in template; with the kind unsaid the AI names it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-draft-write-'));
  const runner = new StubRunner((spec) => ({ structuredOutput: { prompt: '# Feature: dark mode\n\n## Who it is for\nEveryone.', ...(spec.prompt.includes('Decide first') ? { nature: 'code' } : {}) } }));
  const { engine, send, settled } = start(home, runner);
  try {
    const first = await settled((await (await send('POST', '/api/templates/draft', { notes: 'dark mode for the settings page', nature: 'code' })).json()).id);
    expect(first.status).toBe('done');
    expect(first.result).toMatchObject({ values: null, prompt: '# Feature: dark mode\n\n## Who it is for\nEveryone.', nature: null });
    expect(runner.calls[0]!.prompt).toContain('This is a code goal.');
    expect(runner.calls[0]!.prompt).toContain('template "New feature"');
    expect(runner.calls[0]!.prompt).toContain('[feature]');
    const second = await settled((await (await send('POST', '/api/templates/draft', { notes: 'a poster for the summer fair' })).json()).id);
    expect(second.result.nature).toBe('code');
    expect(runner.calls[1]!.prompt).toContain('Decide first what kind of goal');
    // empty notes are refused before any session starts
    expect((await send('POST', '/api/templates/draft', { notes: '   ' })).status).toBe(400);
    expect(runner.calls).toHaveLength(2);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('reading the repository runs read-only in that checkout on the Explainer\'s row; a folder Foundry may not touch is refused; a draft can be stopped', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-draft-repo-'));
  const repo = await makeRepo();
  let release: () => void = () => {};
  const runner = new StubRunner((spec) => (spec.prompt.includes('hold') ? new Promise<Partial<RunResult>>((r) => (release = () => r({ subtype: 'killed_manual', isError: true }))) : { structuredOutput: { values: { feature: 'search' } } }));
  const { engine, send, settled } = start(home, runner);
  engine.config.allowedRoots = [repo];
  try {
    const done = await settled((await (await send('POST', '/api/templates/draft', { notes: 'add search', template: { id: 'code-feature' }, repoPath: repo })).json()).id);
    expect(done.status).toBe('done');
    const spec = runner.calls[0]!;
    expect(spec.cwd).toBe(repo);
    expect(spec.maxTurns).toBeGreaterThan(1);
    expect(spec.allowedTools).toContain('Read');
    expect(spec.disallowedTools).toContain('Write');
    expect(spec.readOnlyShell).toBe(true);
    expect(spec.model).toBe('opus');
    expect(spec.prompt).toContain(`repository at ${repo}`);
    expect((await send('POST', '/api/templates/draft', { notes: 'add search', repoPath: '/' })).status).toBe(403);
    expect((await send('POST', '/api/templates/draft', { notes: 'add search', repoPath: join(repo, 'nope') })).status).toBe(400);

    // stopped: the session is killed and the draft says so
    const held = await (await send('POST', '/api/templates/draft', { notes: 'hold this one', template: { id: 'code-feature' } })).json();
    await waitFor(() => runner.calls.length === 2);
    const stop = await send('DELETE', `/api/templates/draft/${held.id}`);
    expect((await stop.json()).status).toBe('stopped');
    release();
    const after = await settled(held.id);
    expect(after.status).toBe('stopped');
    expect((await send('GET', '/api/templates/draft/td_nope')).status).toBe(404);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}, 30_000);
