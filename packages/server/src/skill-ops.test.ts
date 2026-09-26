import { describe, expect, test } from 'bun:test';
import { InstallError, type Engine, type StreamEvent } from '@foundry/engine';
import { createApp } from './app.ts';
import { SkillOpError, SkillOps, opChannel, opIdOfChannel } from './skill-ops.ts';

const texts = (events: StreamEvent[], channel: string) => events.filter((e) => e.attemptId === channel).map((e) => (e.event as { text: string }).text);
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('the Skills page operations', () => {
  test('each operation streams to its own channel and records how it ended', () => {
    const events: StreamEvent[] = [];
    const ops = new SkillOps((s) => events.push(s));
    const a = ops.begin('install', 'Install one', { id: 'op-aaaa' });
    const b = ops.begin('update', 'Update two', { id: 'op-bbbb' });
    a.say('cloning…');
    b.say('pulling…');
    expect(a.op.channel).toBe('skills-op:op-aaaa');
    expect(a.finish(true, 'one installed').status).toBe('ok');
    // finishing twice keeps the first outcome
    expect(a.finish(false, 'late').status).toBe('ok');
    expect(texts(events, 'skills-op:op-aaaa')).toEqual(['▶ Install one', 'cloning…', '✔ one installed']);
    expect(texts(events, 'skills-op:op-bbbb')).toEqual(['▶ Update two', 'pulling…']);
    expect(ops.get('op-bbbb')?.status).toBe('running');
    expect(ops.history('op-aaaa')).toEqual([
      { kind: 'text', text: '▶ Install one' },
      { kind: 'text', text: 'cloning…' },
      { kind: 'text', text: '✔ one installed' },
    ]);
    expect(ops.history('nope')).toBeNull();
    expect(ops.list().map((o) => o.id)).toEqual(['op-bbbb', 'op-aaaa']);
  });

  test('refuses a malformed or reused id', () => {
    const ops = new SkillOps(() => {});
    ops.begin('install', 'x', { id: 'op-1234' });
    expect(() => ops.begin('install', 'x', { id: 'op-1234' })).toThrow(SkillOpError);
    expect(() => ops.begin('install', 'x', { id: '../x' })).toThrow('bad operation id');
  });

  test('a mirror channel gets the same lines (the older shared tool-install log)', () => {
    const events: StreamEvent[] = [];
    const h = new SkillOps((s) => events.push(s)).begin('tool-install', 'Install t', { mirror: 'tool-install' });
    h.say('$ uv tool install t');
    expect(texts(events, 'tool-install')).toEqual(texts(events, h.op.channel));
  });

  test('keeps the most recent finished operations, never drops a running one', () => {
    const ops = new SkillOps(() => {}, { keep: 2, lines: 10 });
    const running = ops.begin('update', 'long');
    for (let i = 0; i < 4; i++) ops.begin('install', `i${i}`).finish(true, 'ok');
    expect(ops.get(running.op.id)?.status).toBe('running');
    expect(ops.list().length).toBe(2);
  });

  test('a failed run ends the operation and names it on the error', async () => {
    const ops = new SkillOps(() => {});
    const err = await ops.run('install', 'Install gone', { id: 'op-fail' }, async () => {
      throw new Error('not in the catalog');
    }, () => ({ ok: true, summary: '' })).catch((e) => e);
    expect(err.message).toBe('not in the catalog');
    expect(ops.get('op-fail')).toMatchObject({ status: 'failed', summary: 'not in the catalog' });
  });

  test('channel names round-trip', () => {
    expect(opIdOfChannel(opChannel('abcd'))).toBe('abcd');
    expect(opIdOfChannel('tool-install')).toBeNull();
  });
});

/** just enough engine for the Skills routes */
function fakeEngine() {
  const events: StreamEvent[] = [];
  let updating: string | null = null;
  let finishUpdate: () => void = () => {};
  const engine = {
    store: { db: {} },
    config: { dataDir: '/nonexistent', rootDir: '/nonexistent', log: () => {} },
    broadcast: (s: StreamEvent) => events.push(s),
    installTool: async (id: string, say: (l: string) => void) => {
      say(`$ install ${id}`);
      return { ok: id === 'good-tool', command: `install ${id}`, exitCode: id === 'good-tool' ? 0 : 1 };
    },
    skills: {
      install: async (id: string, opts: { onLine?: (l: string) => void }) => {
        if (id === 'missing') throw new InstallError('missing is not in the catalog', 'not-found');
        opts.onLine?.(`cloning ${id}`);
        return { ok: true, id, name: id, path: `/skills/${id}`, commit: 'abcdef1234', manual: null, error: null };
      },
      installTier: async (tiers: string[], onLine?: (l: string) => void) => {
        onLine?.(`installing ${tiers.join('+')}…`);
        return { results: [{ ok: true, id: 'a', name: 'a', path: null, commit: null, manual: null, error: null }] };
      },
      adopt: async (names: string[], onLine?: (l: string) => void) => {
        onLine?.(`adopting ${names.join(',')}`);
        return [{ sourceId: 's', updater: 'adopt', command: [], cwd: '/', exitCode: 0, durationMs: 1, outputTail: '', changed: names.map((name) => ({ name, from: null, to: 'x' })), error: null, at: '' }];
      },
      uninstallMany: async (names: string[]) => ({ results: names.map((name) => ({ name, ok: name !== 'plugin-skill', error: name === 'plugin-skill' ? 'not a user-level skill' : null, note: null })) }),
      updatingSource: () => updating,
      updateSource: (id: string, opts: { onLine?: (l: string) => void }) => {
        updating = id;
        opts.onLine?.(`git pull ${id}`);
        return new Promise((resolve) => {
          finishUpdate = () => {
            updating = null;
            resolve({ sourceId: id, changed: [{ name: 'x', from: 'a', to: 'b' }], error: null });
          };
        });
      },
    },
  };
  const app = createApp(engine as unknown as Engine);
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { app, post, events, finishUpdate: () => finishUpdate() };
}

describe('Skills routes stream each operation to its own channel', () => {
  test('a catalog install streams to the channel the page chose and answers with the finished operation', async () => {
    const { app, post, events } = fakeEngine();
    const res = await post('/api/skills/install', { id: 'tdd', opId: 'page-op-1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, name: 'tdd', op: { id: 'page-op-1', channel: 'skills-op:page-op-1', kind: 'install', status: 'ok', summary: 'tdd installed @ abcdef1' } });
    expect(texts(events, 'skills-op:page-op-1')).toEqual(['▶ Install tdd', 'cloning tdd', '✔ tdd installed @ abcdef1']);
    expect(await (await app.request('/api/skills/ops/page-op-1')).json()).toMatchObject({ status: 'ok' });
    // the output can be read back after a reload
    const h = await (await app.request(`/api/stream/${encodeURIComponent('skills-op:page-op-1')}/history`)).json();
    expect(h.events.map((e: { text: string }) => e.text)).toEqual(['▶ Install tdd', 'cloning tdd', '✔ tdd installed @ abcdef1']);
  });

  test('a failing install keeps its HTTP status and names the failed operation', async () => {
    const { post } = fakeEngine();
    const res = await post('/api/skills/install', { id: 'missing', opId: 'page-op-2' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'missing is not in the catalog', op: { id: 'page-op-2', status: 'failed' } });
  });

  test('callers that pick no id still get one (the CLI), and a reused id is refused', async () => {
    const { post } = fakeEngine();
    const body = await (await post('/api/skills/install', { id: 'tdd' })).json();
    expect(body.op.channel).toStartWith('skills-op:');
    expect((await post('/api/skills/install', { id: 'tdd', opId: 'same-id' })).status).toBe(200);
    expect((await post('/api/skills/install', { id: 'tdd', opId: 'same-id' })).status).toBe(409);
    expect((await post('/api/skills/install', { id: 'tdd', opId: 'no' })).status).toBe(400);
  });

  test('install-tier, adopt and uninstall-many stream their per-skill lines', async () => {
    const { post, events } = fakeEngine();
    expect((await (await post('/api/skills/install-tier', { tiers: ['required'], opId: 'tier-op' })).json()).op).toMatchObject({ kind: 'install-tier', status: 'ok', summary: '1/1 satisfied' });
    expect(texts(events, 'skills-op:tier-op')).toContain('installing required…');
    expect((await (await post('/api/skills/adopt', { names: ['a', 'b'], opId: 'adopt-op' })).json()).op).toMatchObject({ status: 'ok', summary: '2 adopted' });
    expect(texts(events, 'skills-op:adopt-op')).toContain('adopting a,b');
    const un = await (await post('/api/skills/uninstall-many', { names: ['mine', 'plugin-skill'], force: true, opId: 'un-op' })).json();
    expect(un.results.length).toBe(2);
    expect(un.op).toMatchObject({ kind: 'uninstall', status: 'failed' });
    expect(texts(events, 'skills-op:un-op')).toEqual(['▶ Uninstall 2 skills', '✔ mine → trash', '✘ plugin-skill: not a user-level skill', '✘ 1 moved to the trash; not removed: plugin-skill (not a user-level skill)']);
  });

  test('a source update runs in the background; a second one is refused while it runs', async () => {
    const { app, post, events, finishUpdate } = fakeEngine();
    const res = await post('/api/skills/sources/owner%2Frepo/update', { opId: 'upd-op' });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ channel: 'skills-op:upd-op', op: { status: 'running', kind: 'update' } });
    await settle();
    const busy = await post('/api/skills/sources/other/update', { opId: 'upd-op-2' });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toContain('owner/repo');
    expect(await (await app.request('/api/skills/ops/upd-op-2')).json()).toMatchObject({ error: expect.stringContaining('unknown operation') });
    finishUpdate();
    await settle();
    expect(await (await app.request('/api/skills/ops/upd-op')).json()).toMatchObject({ status: 'ok', summary: 'owner/repo: 1 changed (x)' });
    expect(texts(events, 'skills-op:upd-op')).toEqual(['▶ Update owner/repo', 'git pull owner/repo', '✔ owner/repo: 1 changed (x)']);
    expect((await (await app.request('/api/skills/ops')).json()).ops.map((o: { id: string }) => o.id)).toEqual(['upd-op']);
  });

  test('tool installs: the page follows its own channel, other pages keep the shared tool-install log', async () => {
    const { app, post, events } = fakeEngine();
    const mine = await post('/api/tools/install', { id: 'good-tool', opId: 'tool-op' });
    expect(mine.status).toBe(202);
    expect((await mine.json()).channel).toBe('skills-op:tool-op');
    const legacy = await (await post('/api/tools/install', { id: 'bad-tool' })).json();
    expect(legacy.channel).toBe('tool-install');
    await settle();
    expect(texts(events, 'tool-install')).toEqual(['▶ Install bad-tool', '$ install bad-tool', '✘ bad-tool: `install bad-tool` exited 1']);
    expect(texts(events, 'skills-op:tool-op')).toEqual(['▶ Install good-tool', '$ install good-tool', '✔ good-tool installed']);
    expect(await (await app.request(`/api/skills/ops/${legacy.op.id}`)).json()).toMatchObject({ status: 'failed' });
  });
});
