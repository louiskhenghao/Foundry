import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexMcpManager } from './codex-manager.ts';

const dirs: string[] = [];
const managers: CodexMcpManager[] = [];
afterEach(async () => { for (const manager of managers.splice(0)) await manager.stop(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const catalogPath = resolve(import.meta.dir, '../../../../catalog/mcp.json');
function setup(servers: any[] = [], status?: any[]) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-native-mcp-')); dirs.push(dir);
  const codexHome = join(dir, 'codex-home'); mkdirSync(codexHome);
  const processHome = join(dir, 'process-home'); mkdirSync(processHome);
  writeFileSync(join(codexHome, 'fixture.json'), JSON.stringify(servers));
  writeFileSync(join(codexHome, 'status.json'), JSON.stringify(status ?? []));
  const codexBin = join(dir, 'fixture-cli');
  writeFileSync(codexBin, `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
const home = process.env.CODEX_HOME;
const args = process.argv.slice(2);
appendFileSync(home + '/calls.jsonl', JSON.stringify({args, home, processHome:process.env.HOME}) + '\\n');
if (existsSync(home+'/hang')) { writeFileSync(home+'/active.pid',String(process.pid)); process.on('SIGTERM',()=>{}); await Bun.sleep(60000); }
const state = JSON.parse(readFileSync(home + '/fixture.json', 'utf8'));
const save = () => writeFileSync(home + '/fixture.json', JSON.stringify(state));
if (args[0] === 'app-server') {
  createInterface({input:process.stdin}).on('line', line => {
    const msg=JSON.parse(line);
    appendFileSync(home + '/rpc.jsonl', line + '\\n');
    if (msg.method === 'initialize') process.stdout.write(JSON.stringify({id:msg.id,result:{userAgent:'fixture/1'}})+'\\n');
    if (msg.method === 'mcpServerStatus/list') process.stdout.write(JSON.stringify({id:msg.id,result:{data:JSON.parse(readFileSync(home+'/status.json','utf8')),nextCursor:null}})+'\\n');
  });
} else if (args[1] === 'list') {
  if(existsSync(home + '/hang')) { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
  else console.log(JSON.stringify(state));
} else if (args[1] === 'add') {
  const name=args[2], urlAt=args.indexOf('--url'), dash=args.indexOf('--');
  const transport = urlAt>=0 ? {type:'streamable_http',url:args[urlAt+1]} : {type:'stdio',command:args[dash+1],args:args.slice(dash+2),env:{}};
  if (dash>=0) for(let i=3;i<dash;i++) if(args[i]==='--env') { const value=args[++i], eq=value.indexOf('=');transport.env[value.slice(0,eq)]=value.slice(eq+1); }
  const old=state.findIndex(s=>s.name===name);if(old>=0)state.splice(old,1);
  state.push({name,enabled:true,transport});save();
  console.log('Saved config; do not show environment values:',JSON.stringify(transport));
} else if (args[1] === 'remove') {const i=state.findIndex(s=>s.name===args[2]);if(i>=0)state.splice(i,1);save();}
else if (args[1] === 'login') {
  console.log('Authorize: https://oauth.example.com/authorize?state=opaque-state');
  process.stdout.write('Paste the callback URL: ');
  createInterface({input:process.stdin}).on('line',line=>{console.log('Received secret callback '+line);process.exit(0);});
}
`);
  chmodSync(codexBin, 0o755);
  let allowed: string[] = [];
  const logs: string[] = [];
  const manager = new CodexMcpManager({ codexBin, codexHome, processHome, catalogPath, allowed: () => allowed, setAllowed: (value) => { allowed = value; }, log: (line) => logs.push(line), timeoutMs: 2_000 });
  managers.push(manager);
  return { dir, codexHome, processHome, manager, logs, allowed: () => allowed, calls: () => readFileSync(join(codexHome, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) };
}
const local = { name: 'local', enabled: true, transport: { type: 'stdio', command: '/usr/bin/node', args: ['server.js', '--token', 'sensitive-key'], env: { PRIVATE: 'sensitive-key' } }, auth_status: 'unsupported' };
const remote = { name: 'remote', enabled: true, transport: { type: 'streamable_http', url: 'https://user:sensitive-key@example.com/private-token?api_key=sensitive-key', http_headers: { Authorization: 'Bearer sensitive-key' } } };

describe('CodexMcpManager', () => {
  test('shutdown awaits native cleanup, cancels queued writes and rejects new work', async () => {
    const t=setup();
    writeFileSync(join(t.codexHome,'hang'),'');
    const listing=t.manager.view().catch(error=>error);
    for(let i=0;!existsSync(join(t.codexHome,'active.pid')) && i<100;i++) await Bun.sleep(10);
    const pid=Number(readFileSync(join(t.codexHome,'active.pid'),'utf8'));
    const queued=t.manager.install({custom:{name:'queued',config:{type:'stdio',command:'node'}}},{}).catch(error=>error);
    await t.manager.stop();
    expect(await listing).toBeInstanceOf(Error);
    expect(await queued).toBeInstanceOf(Error);
    expect(()=>process.kill(pid,0)).toThrow();
    expect(t.calls()).toHaveLength(1);
    await expect(t.manager.view()).rejects.toThrow('stopped');
    await expect(t.manager.check()).rejects.toThrow('stopped');
    expect(()=>t.manager.allow('mcp__queued',true)).toThrow('stopped');
  });
  test('lists native servers without exposing environment, arguments, headers or URL secrets', async () => {
    const t = setup([local, remote]);
    const view = await t.manager.view();
    expect(view.servers.map((s) => [s.name, s.target, s.transport])).toEqual([['local', 'node', 'stdio'], ['remote', 'https://example.com', 'http']]);
    expect(JSON.stringify(view)).not.toContain('sensitive-key');
    expect(JSON.stringify(view)).not.toContain('private-token');
    expect(t.calls()[0]).toMatchObject({ home: t.codexHome, processHome: t.processHome, args: ['mcp', 'list', '--json'] });
  });

  test('installs and replaces using native add without remove-first, hides keys, and preserves policy', async () => {
    const t = setup();
    const say = (line: string) => t.logs.push(line);
    expect(await t.manager.install({ catalogId: 'exa' }, { EXA_API_KEY: 'secret-one' }, say)).toEqual({ ok: true, error: null });
    expect(t.allowed()).toContain('mcp__exa');
    t.manager.allow('mcp__exa', false);
    expect((await t.manager.install({ catalogId: 'exa' }, { EXA_API_KEY: 'secret-two' }, say, true)).ok).toBe(true);
    expect(t.allowed()).not.toContain('mcp__exa');
    expect(t.calls().filter((call) => call.args[1] === 'remove')).toHaveLength(0);
    expect(t.logs.join('\n')).not.toContain('secret-one');
    expect(t.logs.join('\n')).not.toContain('secret-two');
    expect(t.calls().find((call) => call.args[1] === 'add').args).toEqual(['mcp', 'add', 'exa', '--env', 'EXA_API_KEY=secret-one', '--', 'npx', '-y', 'exa-mcp-server']);
    expect((await t.manager.install({ catalogId: 'exa' }, { EXA_API_KEY: 'x' })).error).toContain('already installed');
  });

  test('validates unsupported transports, keys, names and arguments before invoking the CLI', async () => {
    const t = setup();
    expect((await t.manager.install({ custom: { name: 'old', config: { type: 'sse', url: 'https://example.com' } } }, {})).error).toContain('legacy SSE');
    expect((await t.manager.install({ catalogId: 'exa' }, {})).ok).toBe(false);
    expect((await t.manager.install({ custom: { name: 'bad__name', config: { type: 'http', url: 'https://example.com' } } }, {})).ok).toBe(false);
    expect((await t.manager.install({ custom: { name: 'safe', config: { type: 'http', url: 'https://example.com' } } }, { KEY: 'hidden' })).ok).toBe(false);
    expect((await t.manager.install({ custom: { name: 'safe', config: { type: 'stdio', command: 'node', args: [5 as any] } } }, {})).ok).toBe(false);
    expect(() => t.calls()).toThrow();
  });

  test('custom installs stay off, and removal deletes only native config plus its allowed prefix', async () => {
    const t = setup();
    expect((await t.manager.install({ custom: { name: 'custom', config: { type: 'stdio', command: 'node', args: ['test.js'] } } }, {})).ok).toBe(true);
    expect(t.allowed()).toEqual([]);
    t.manager.allow('mcp__custom', true);
    expect((await t.manager.remove('custom')).ok).toBe(true);
    expect((await t.manager.view()).servers).toEqual([]);
    expect(t.allowed()).toEqual([]);
    expect(() => t.manager.allow('Bash', true)).toThrow();
  });

  test('checks real discovery status and reconnects without starting a model turn', async () => {
    const t = setup([local, remote, { ...local, name: 'failed' }, { ...local, name: 'unknown' }], [
      { name: 'local', tools: {}, serverInfo: { name: 'fixture' }, serverCapabilities: {}, toolsError: null, runtimeStatus: null },
      { name: 'remote', authStatus: 'notLoggedIn', toolsError: 'secret-key' },
      { name: 'failed', toolsError: 'sensitive-key' },
      { name: 'unknown', authStatus: 'oAuth', tools: {} },
    ]);
    const health = await t.manager.reconnect();
    expect(health.map((h) => [h.name, h.status])).toEqual([['local', 'connected'], ['remote', 'needs-auth'], ['failed', 'failed'], ['unknown', 'unknown']]);
    expect(JSON.stringify(health)).not.toContain('sensitive-key');
    const methods = readFileSync(join(t.codexHome, 'rpc.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line).method);
    expect(methods).toEqual(['initialize', 'initialized', 'mcpServerStatus/list']);
  });

  test('OAuth exposes an authorization link, accepts only a callback URL, and never logs callback secrets', async () => {
    const t = setup([remote]);
    const session = await t.manager.startLogin('remote');
    expect(session.url).toBe('https://oauth.example.com/authorize?state=opaque-state');
    expect(session.needsCode).toBe(true);
    expect(() => t.manager.login.submit('https://attacker.example.com/?code=secret-code')).toThrow('localhost');
    t.manager.login.submit('http://localhost:9876/callback?code=secret-code&state=opaque-state');
    for (let i = 0; !session.done && i < 100; i++) await Bun.sleep(10);
    expect(session.ok).toBe(true);
    expect(session.lines.join('\n')).not.toContain('secret-code');
    expect(t.logs.join('\n')).not.toContain('secret-code');
    expect(t.calls().find((c) => c.args[1] === 'login').args).toEqual(['mcp', 'login', 'remote', '--no-browser']);
  });

  test('cancels native OAuth and rejects stdio sign-in', async () => {
    const t = setup([remote, local]);
    await expect(t.manager.startLogin('local')).rejects.toThrow('Only HTTP');
    const session = await t.manager.startLogin('remote');
    t.manager.login.cancel();
    expect(session).toMatchObject({ done: true, ok: false, error: 'cancelled' });
  });

  test('bounds a native CLI that never finishes', async () => {
    const t = setup();
    writeFileSync(join(t.codexHome, 'hang'), '');
    await expect(t.manager.view()).rejects.toThrow('timed out');
  }, 5_000);
});
