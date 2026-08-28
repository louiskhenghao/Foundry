import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextWindowFor } from './context-windows.ts';
import { AgentsMonitor, type AgentsMonitorDeps } from './monitor.ts';
import { liveRegistry, recentTranscripts } from './scan.ts';

const SID_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID_DONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID_OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SID_FOUNDRY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SID_WT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const line = (v: unknown) => `${JSON.stringify(v)}\n`;
const assistant = (model: string, cwd = '/repo') => ({
  type: 'assistant',
  timestamp: new Date().toISOString(),
  cwd,
  gitBranch: 'main',
  entrypoint: 'claude-vscode',
  version: '2.1.247',
  message: { model, content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 } },
});

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'agents-home-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'agents-data-'));
  const proj = join(home, 'projects', '-repo');
  mkdirSync(join(home, 'sessions'), { recursive: true });
  mkdirSync(proj, { recursive: true });

  // live registry: this test process (alive), a dead pid, and a secret key decoy that must never be parsed
  writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID_LIVE, cwd: '/repo', startedAt: Date.now() - 5_000, entrypoint: 'claude-vscode', name: 'my-session', version: '2.1.247' }));
  writeFileSync(join(home, 'sessions', '4000000.json'), JSON.stringify({ pid: 4_000_000, sessionId: SID_DONE }));
  writeFileSync(join(home, 'sessions', '12345.abcdef.key'), 'SECRET-NOT-JSON');

  // live transcript: fresh, with subagents (one still running, one already returned to the parent)
  writeFileSync(
    join(proj, `${SID_LIVE}.jsonl`),
    [
      line({ type: 'user', timestamp: new Date().toISOString(), message: { content: 'start' } }),
      line(assistant('claude-fable-5')),
      line({ type: 'ai-title', aiTitle: 'Live session' }),
      line({ type: 'user', toolUseResult: { ok: true }, sourceToolUseID: 'tu-done', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-done', content: 'done' }] } }),
    ].join(''),
  );
  const sub = join(proj, SID_LIVE, 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-run1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'still running', toolUseId: 'tu-run' }));
  writeFileSync(join(sub, 'agent-run1.jsonl'), line({ type: 'user', isSidechain: true, agentId: 'run1', message: { content: 'sub work' } }));
  writeFileSync(join(sub, 'agent-fin1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'came back', toolUseId: 'tu-done' }));
  writeFileSync(join(sub, 'agent-fin1.jsonl'), line({ type: 'user', message: { content: 'sub done' } }));

  // finished 2h ago / too old (25h) / a headless run inside the engine's own worktrees
  writeFileSync(join(proj, `${SID_DONE}.jsonl`), line(assistant('claude-opus-5[1m]')));
  ageFile(join(proj, `${SID_DONE}.jsonl`), 2 * 3600);
  writeFileSync(join(proj, `${SID_OLD}.jsonl`), line(assistant('claude-fable-5')));
  ageFile(join(proj, `${SID_OLD}.jsonl`), 25 * 3600);
  writeFileSync(join(proj, `${SID_WT}.jsonl`), line(assistant('claude-fable-5', join(dataDir, 'worktrees', 'g2'))));
  ageFile(join(proj, `${SID_WT}.jsonl`), 3600);

  return { home, dataDir, proj };
}

function ageFile(path: string, seconds: number) {
  const t = (Date.now() - seconds * 1000) / 1000;
  utimesSync(path, t, t);
}

const deps = (over: Partial<AgentsMonitorDeps> = {}): AgentsMonitorDeps => ({
  foundryLive: () => [{ taskId: 't1', goalId: 'g1', attemptId: 'at1', sessionId: SID_FOUNDRY, pid: 123, model: 'claude-opus-5', cwd: '/data/worktrees/g1', startedAt: new Date().toISOString(), killable: true }],
  foundryRecent: () => [],
  goalTitle: () => 'My goal',
  ...over,
});

describe('contextWindowFor', () => {
  test('defaults 200k; [1m] ids get 1M; usage above the window proves the 1M tier', () => {
    expect(contextWindowFor('claude-fable-5')).toBe(200_000);
    expect(contextWindowFor('claude-opus-5[1m]')).toBe(1_000_000);
    // a [1m] session reports the plain id in its transcript — only its usage gives it away
    expect(contextWindowFor('claude-fable-5', 206_587)).toBe(1_000_000);
    expect(contextWindowFor('claude-fable-5', 55_000)).toBe(200_000);
  });
});

describe('scan', () => {
  test('liveRegistry keeps only alive pids and never touches key files', () => {
    const { home } = fixture();
    const live = liveRegistry(home);
    expect(live.map((l) => l.sessionId)).toEqual([SID_LIVE]);
    expect(live[0]!.name).toBe('my-session');
  });

  test('recentTranscripts is a stat-only window filter', () => {
    const { home } = fixture();
    const ids = recentTranscripts(home, Date.now() - 24 * 3600 * 1000).map((t) => t.sessionId);
    expect(ids).toContain(SID_LIVE);
    expect(ids).toContain(SID_DONE);
    expect(ids).toContain(SID_WT);
    expect(ids).not.toContain(SID_OLD);
  });
});

describe('AgentsMonitor.list', () => {
  test('merges foundry + external rows with status, metadata, and nested subagents', () => {
    const { home, dataDir } = fixture();
    const m = new AgentsMonitor({ claudeHome: home, dataDir }, deps());
    const { sessions, summary } = m.list();
    const byId = Object.fromEntries(sessions.map((s) => [s.sessionId, s]));

    const foundry = byId[SID_FOUNDRY]!;
    expect(foundry.source).toBe('foundry');
    expect(foundry.status).toBe('busy');
    expect(foundry.foundry).toMatchObject({ goalId: 'g1', goalTitle: 'My goal', taskId: 't1', killable: true });

    const live = byId[SID_LIVE]!;
    expect(live.source).toBe('external');
    expect(live.status).toBe('busy'); // fresh mtime
    expect(live.model).toBe('claude-fable-5');
    expect(live.title).toBe('Live session');
    expect(live.contextUsedTokens).toBe(600);
    expect(live.contextWindowTokens).toBe(200_000);
    expect(live.entrypoint).toBe('claude-vscode');
    const subs = Object.fromEntries(live.subagents.map((s) => [s.agentId, s.status]));
    expect(subs).toEqual({ run1: 'running', fin1: 'done' });

    const done = byId[SID_DONE]!;
    expect(done.status).toBe('finished');
    expect(done.contextWindowTokens).toBe(1_000_000); // [1m] model
    expect(done.endedAt).toBeTruthy();

    // headless run inside the engine's worktrees is attributed to Foundry even without a goal link
    expect(byId[SID_WT]!.source).toBe('foundry');

    expect(byId[SID_OLD]).toBeUndefined();
    expect(summary).toEqual({ busy: 2, idle: 0, finished: 2, total: 4 });
  });

  test('a live process with a stale transcript reads idle, not busy', () => {
    const { home, dataDir, proj } = fixture();
    ageFile(join(proj, `${SID_LIVE}.jsonl`), 120);
    const m = new AgentsMonitor({ claudeHome: home, dataDir }, deps());
    expect(m.list().sessions.find((s) => s.sessionId === SID_LIVE)!.status).toBe('idle');
  });

  test('a foundry-owned session in the registry is not duplicated as external', () => {
    const { home, dataDir } = fixture();
    // engine state wins: the registry knowing about this pid must not add a second, external row
    writeFileSync(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID_FOUNDRY, cwd: '/x', startedAt: Date.now() }));
    const m = new AgentsMonitor({ claudeHome: home, dataDir }, deps());
    const rows = m.list().sessions.filter((s) => s.sessionId === SID_FOUNDRY);
    expect(rows.length).toBe(1);
    expect(rows[0]!.source).toBe('foundry');
  });
});

describe('AgentsMonitor.log', () => {
  test('incremental parsed log for sessions and subagents; unknown ids return null', () => {
    const { home, dataDir } = fixture();
    const m = new AgentsMonitor({ claudeHome: home, dataDir }, deps());
    const c1 = m.log(SID_LIVE, null, 0)!;
    expect(c1.items.length).toBeGreaterThan(0);
    expect(c1.eof).toBe(true);
    expect(c1.status).toBe('busy');
    expect(m.log(SID_LIVE, null, c1.offset)!.items).toEqual([]);

    const sub = m.log(SID_LIVE, 'run1', 0)!;
    expect(sub.items[0]).toMatchObject({ kind: 'user', text: 'sub work' });

    expect(m.log('99999999-9999-4999-8999-999999999999', null, 0)).toBeNull();
    expect(m.log(SID_LIVE, 'no-such-agent', 0)).toBeNull();
    const finished = m.log(SID_DONE, null, 0)!;
    expect(finished.status).toBe('finished');
  });
});
