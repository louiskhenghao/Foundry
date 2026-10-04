import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentsMonitor } from './monitor.ts';
import { CodexHistoryClient } from './codex-client.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'foundry-codex-history-')); dirs.push(home);
  let now = Date.now();
  const thread = (id: string, over: any = {}) => ({ id, source: 'appServer', name: `Title ${id}`, model: 'model-native', cwd: '/fixture/repository', createdAt: now / 1000 - 100, updatedAt: now / 1000, status: { type: 'notLoaded' }, cliVersion: '0.158.0', parentThreadId: null, ...over });
  const state = {
    pages: [[thread('owned'), thread('owned-child', { parentThreadId: 'owned' }), thread('external'), thread('child', { parentThreadId: 'external', agentRole: 'reviewer' })], [thread('second')]],
    items: [
      { turnId: 'turn', startedAtMs: now, item: { id: 'assistant', type: 'agentMessage', text: 'A native response' } },
      { turnId: 'turn', startedAtMs: now - 1, item: { id: 'command', type: 'commandExecution', command: 'git status', aggregatedOutput: 'clean', exitCode: 0, status: 'completed' } },
      { turnId: 'turn', startedAtMs: now - 2, item: { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'The user prompt' }] } },
    ],
    fail: false, version: '0.158.0', hang: false,
  };
  const save = () => writeFileSync(join(home, 'state.json'), JSON.stringify(state)); save();
  writeFileSync(join(home, 'auth.json'), 'credential-decoy-must-not-be-opened-by-foundry');
  const bin = join(home, 'fixture-codex');
  writeFileSync(bin, `#!${process.execPath}
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';import {createInterface} from 'node:readline';
const home=process.env.CODEX_HOME;writeFileSync(home+'/pid',String(process.pid));
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),s=JSON.parse(readFileSync(home+'/state.json','utf8'));
 appendFileSync(home+'/calls.jsonl',line+'\\n');
 const send=result=>console.log(JSON.stringify({id:m.id,result}));
 if(m.method==='initialize'){send({userAgent:'Codex/'+s.version});return;}
 if(m.method==='initialized')return;
 if(s.hang)return;
 if(s.fail){console.log(JSON.stringify({id:m.id,error:{message:'fixture failure'}}));return;}
 if(m.method==='thread/list'){const page=Number(m.params.cursor??0);send({data:s.pages[page]??[],nextCursor:page+1<s.pages.length?String(page+1):null});}
 else if(m.method==='thread/read')send({thread:{id:m.params.threadId,model:'model-native'}});
 else if(m.method==='thread/turns/list')send({data:[{id:'turn',startedAt:1700000000}],nextCursor:null});
 else if(m.method==='thread/items/list'){const page=Number(m.params.cursor??0);send({data:s.items.slice(page*2,page*2+2),nextCursor:(page+1)*2<s.items.length?String(page+1):null});}
 else {writeFileSync(home+'/FORBIDDEN_METHOD',m.method);process.exit(1);}
});`);
  chmodSync(bin, 0o755);
  const monitor = new AgentsMonitor({ claudeHome: join(home, 'claude'), codexHome: home, codexBin: bin, codexProcessHome: home, codexTimeoutMs: 2_000, dataDir: join(home, 'data') }, { foundryLive: () => [], foundryRecent: () => [], goalTitle: () => null, foundrySessionIds: () => ['owned'], now: () => now });
  const calls = () => readFileSync(join(home, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { home, bin, monitor, state, save, calls, advance: (ms: number) => { now += ms; } };
}

describe('external Codex sessions', () => {
  test('merges read-only metadata, deduplicates owned sessions/children, and never invents process status', async () => {
    const t = setup();
    const [list, summary] = await Promise.all([t.monitor.list(), t.monitor.summary()]);
    expect(list.sessions.map((row) => row.sessionId)).toEqual(['external', 'second']);
    expect(summary).toEqual({ busy: 0, idle: 0, finished: 0, unknown: 2, total: 2 });
    expect(list.sessions[0]).toMatchObject({ provider: 'codex', source: 'external', status: 'unknown', pid: null, endedAt: null, foundry: null });
    expect(list.sessions[0]!.subagents).toEqual([{ agentId: 'child', agentType: 'reviewer', description: 'Title child', status: 'unknown', lastActivityAt: list.sessions[0]!.lastActivityAt }]);
    const calls = t.calls();
    expect(calls.filter((call) => call.method === 'initialize')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'thread/list')).toHaveLength(2);
    for (const call of calls.filter((value) => value.method === 'thread/list')) expect(call.params.useStateDbOnly).toBe(true);
    expect(calls.map((call) => call.method)).not.toContain('thread/read');
    await t.monitor.list();
    expect(t.calls()).toHaveLength(calls.length);
  });

  test('lazy paginated history translates native items and appends new entries without repeating unchanged entries', async () => {
    const t = setup();
    const first = (await t.monitor.log('external', null, 0))!;
    expect(first.status).toBe('unknown');
    expect(first.items.map((item) => item.kind)).toEqual(['notice', 'user', 'tool_use', 'tool_result', 'assistant']);
    expect(first.items[1]).toMatchObject({ kind: 'user', text: 'The user prompt' });
    expect((await t.monitor.log('external', null, first.offset))!.items).toEqual([]);
    expect(await t.monitor.log('external', 'unrelated-session', 0)).toBeNull();
    expect(await t.monitor.log('not-in-catalog', null, 0)).toBeNull();
    expect((await t.monitor.log('external', 'child', 0))!.items.length).toBeGreaterThan(0);
    t.state.items.unshift({ turnId: 'turn', startedAtMs: Date.now(), item: { id: 'new-message', type: 'agentMessage', text: 'New message' } } as any);
    t.save(); t.advance(6_000);
    const next = (await t.monitor.log('external', null, first.offset))!;
    expect(next.items).toMatchObject([{ kind: 'assistant', text: 'New message' }]);
    const methods = new Set(t.calls().map((call) => call.method));
    expect([...methods].sort()).toEqual(['initialize', 'initialized', 'thread/items/list', 'thread/list', 'thread/read', 'thread/turns/list']);
    for (const call of t.calls().filter((value) => value.method === 'thread/read')) expect(call.params.includeTurns).toBe(false);
    expect(readFileSync(join(t.home, 'auth.json'), 'utf8')).toBe('credential-decoy-must-not-be-opened-by-foundry');
  });

  test('refresh failures retain the last catalog with an explicit warning', async () => {
    const t = setup();
    const before = await t.monitor.list();
    t.state.fail = true; t.save(); t.advance(21_000);
    const after = await t.monitor.list();
    expect(after.sessions).toEqual(before.sessions);
    expect(after.warnings?.[0]).toContain('last successful snapshot');
  });

  test('older CLIs fail explicitly before sending the database-only listing request', async () => {
    const t = setup(); t.state.version = '0.157.0'; t.save();
    const list = await t.monitor.list();
    expect(list.sessions).toEqual([]);
    expect(list.warnings?.[0]).toContain('0.158 or newer');
    expect(t.calls().map((call) => call.method)).toEqual(['initialize']);
  });

  test('the client rejects mutation methods and shutdown cancels pending reads', async () => {
    const t = setup();
    const client = new CodexHistoryClient({ codexBin: t.bin, codexHome: t.home });
    await expect(client.read((request) => request('thread/resume', { threadId: 'external' }))).rejects.toThrow('only permits history reads');
    t.state.hang = true; t.save();
    const pending = t.monitor.list();
    for (let i = 0; !t.calls().some((call) => call.method === 'thread/list') && i < 100; i++) await Bun.sleep(10);
    t.monitor.stop();
    expect((await pending).warnings?.[0]).toContain('closed before responding');
    expect(t.calls().some((call) => call.method === 'thread/resume')).toBe(false);
  });
});
