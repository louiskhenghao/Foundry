import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCodexModels } from './codex-discover.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A native-process fixture exercises the actual stdio boundary without a CLI, account, or network. */
function server(body: string) {
  const home = mkdtempSync(join(tmpdir(), 'foundry-codex-catalog-'));
  dirs.push(home);
  const bin = join(home, 'codex-fixture');
  writeFileSync(bin, `#!${process.execPath}\nimport { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync(process.env.CODEX_HOME + '/pid', String(process.pid));
const send = (id, result) => process.stdout.write(JSON.stringify({id, result}) + '\\n');
let initialized = false;
createInterface({input:process.stdin}).on('line', (line) => {
  const msg = JSON.parse(line);
  appendFileSync(process.env.CODEX_HOME + '/requests.jsonl', line + '\\n');
  ${body}
});\n`);
  chmodSync(bin, 0o755);
  return { home, bin, requests: () => readFileSync(join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)), pid: () => Number(readFileSync(join(home, 'pid'), 'utf8')) };
}

const initialize = `
  if (msg.method === 'initialize') { send(msg.id, {userAgent:'Codex Desktop/1.2.3 (test)'}); return; }
  if (msg.method === 'initialized') { initialized = true; return; }
  if (!initialized) throw Error('model/list before initialized');
`;
const visible = { id: 'catalog-id', model: 'model-one', displayName: 'Model one', description: 'A model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'max' }, { reasoningEffort: 'max' }], defaultReasoningEffort: 'low', isDefault: true };

describe('discoverCodexModels', () => {
  test('initializes, follows all pages, preserves dynamic efforts and filters hidden models', async () => {
    const fixture = server(`${initialize}
      process.stdout.write(JSON.stringify({method:'catalog/progress',params:{}})+'\\n');
      if (!msg.params.cursor) send(msg.id, {data:[${JSON.stringify(visible)}, {id:'hidden',hidden:true}],nextCursor:'next'});
      else send(msg.id, {data:[{id:'older-catalog-model'}], nextCursor:null});
    `);
    const result = await discoverCodexModels(fixture.bin, fixture.home);
    expect(result).toEqual({ cliVersion: '1.2.3', models: [
      { id: 'model-one', displayName: 'Model one', description: 'A model', reasoningEfforts: ['low', 'max'], defaultReasoningEffort: 'low', isDefault: true },
      { id: 'older-catalog-model', displayName: null, description: null, reasoningEfforts: [], defaultReasoningEffort: null, isDefault: false },
    ] });
    const requests = fixture.requests();
    expect(requests.map((msg) => msg.method)).toEqual(['initialize', 'initialized', 'model/list', 'model/list']);
    expect(requests[2].params.includeHidden).toBe(false);
    expect(requests[3].params.cursor).toBe('next');
    expect(() => process.kill(fixture.pid(), 0)).toThrow();
  });

  test('can explicitly include hidden models and handles a response split across chunks', async () => {
    const fixture = server(`${initialize}
      const response=JSON.stringify({id:msg.id,result:{data:[{id:'hidden',hidden:true}],nextCursor:null}})+'\\n';
      process.stdout.write(response.slice(0,12));
      setTimeout(() => process.stdout.write(response.slice(12)), 10);
    `);
    const result = await discoverCodexModels(fixture.bin, fixture.home, { includeHidden: true });
    expect(result.models.map((m) => m.id)).toEqual(['hidden']);
    expect(fixture.requests()[2].params.includeHidden).toBe(true);
  });

  test('reports RPC errors without claiming catalog success and cleans up the process', async () => {
    const fixture = server(`${initialize}
      process.stdout.write(JSON.stringify({id:msg.id,error:{code:-32601,message:'model/list not supported'}})+'\\n');
    `);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('Codex model/list (-32601): model/list not supported');
    expect(() => process.kill(fixture.pid(), 0)).toThrow();
  });

  test('rejects malformed catalogs instead of replacing previous caller data with an empty list', async () => {
    const fixture = server(`${initialize} send(msg.id, {models:[]});`);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('invalid model catalog');
  });

  test('rejects malformed JSON and terminates the process', async () => {
    const fixture = server(`${initialize} process.stdout.write('{invalid json}\\n');`);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('invalid JSON');
    expect(() => process.kill(fixture.pid(), 0)).toThrow();
  });

  test('detects repeating pagination cursors', async () => {
    const fixture = server(`${initialize} send(msg.id, {data:[],nextCursor:'same'});`);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('repeated a pagination cursor');
  });

  test('bounds the model count across pages before returning a partial catalog', async () => {
    const fixture = server(`${initialize} send(msg.id, {data:[{id:'same-model'}],nextCursor:String(msg.id)});`);
    await expect(discoverCodexModels(fixture.bin, fixture.home, { maxModels: 2 })).rejects.toThrow('exceeded the 2 model limit');
  });

  test('bounds malformed stdout lines', async () => {
    const fixture = server(`${initialize} process.stdout.write('x'.repeat(2 * 1024 * 1024 + 1));`);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('response size limit');
  });

  test('bounds a hung app-server and kills a process that ignores SIGTERM', async () => {
    const fixture = server(`process.on('SIGTERM', () => {});`);
    const start = Date.now();
    await expect(discoverCodexModels(fixture.bin, fixture.home, { timeoutMs: 1_000 })).rejects.toThrow('timed out');
    expect(fixture.requests().map((msg) => msg.method)).toEqual(['initialize']);
    expect(Date.now() - start).toBeLessThan(3_000);
    // SIGKILL can be acknowledged just after the bounded cleanup timer resolves.
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(fixture.pid(), 0); } catch { return; }
      await Bun.sleep(10);
    }
    throw new Error('app-server survived cleanup');
  });

  test('reports an early CLI exit and its diagnostic', async () => {
    const fixture = server(`process.stderr.write('bad config file\\n'); process.exit(2);`);
    await expect(discoverCodexModels(fixture.bin, fixture.home)).rejects.toThrow('bad config file');
  });

  test('reports a missing binary', async () => {
    await expect(discoverCodexModels('/nonexistent/foundry-codex-cli', tmpdir())).rejects.toThrow('Cannot start Codex model discovery');
  });
});
