import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexPlugins, parsePlugins } from './codex-plugins.ts';

const row = { pluginId: 'example@fixture', name: 'Example', marketplaceName: 'fixture', version: '1.0', installed: false, enabled: false, installPolicy: 'AVAILABLE', authPolicy: 'ON_INSTALL', source: { path: '/private/fixture' } };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanup.splice(0)) await clean(); });
function fixture(mode = 'ok') {
  const home = mkdtempSync(join(tmpdir(), 'foundry-plugin-test-'));
  const bin = join(home, 'codex');
  writeFileSync(join(home, 'state.json'), JSON.stringify({ mode, installed: false }));
  writeFileSync(bin, `#!${process.execPath}
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const home=process.env.CODEX_HOME, args=process.argv.slice(2), path=home+'/state.json';
appendFileSync(home+'/calls',JSON.stringify({args,home:process.env.HOME,codexHome:home})+'\\n');
const state=JSON.parse(readFileSync(path,'utf8'));
if(state.mode==='hang') await Bun.sleep(60000);
if(state.mode==='slow-list') await Bun.sleep(100);
if(state.mode==='failure'){console.error('private-token-fixture');process.exit(1);}
if(state.mode==='invalid'){console.log('not JSON private-token-fixture');process.exit(0);}
if(args[1]==='list'){
 const row={...${JSON.stringify(row)},installed:state.installed,enabled:state.installed,installPolicy:state.mode==='managed'?'REQUIRED':'AVAILABLE'};
 console.log(JSON.stringify({installed:state.installed?[row]:[],available:state.installed?[]:[row]}));
}else{
 if(state.mode!=='unchanged') {state.installed=args[1]==='add';writeFileSync(path,JSON.stringify(state));}
 console.log(JSON.stringify({pluginId:state.mode==='wrong-id'?'other@fixture':args[2]}));
}
`);
  chmodSync(bin, 0o755);
  const manager = new CodexPlugins({ codexHome: home, processHome: home, codexBin: bin, timeoutMs: 1000 });
  cleanup.push(async () => { await manager.stop(); rmSync(home, { recursive: true, force: true }); });
  return { manager, home, calls: () => { try { return readFileSync(join(home, 'calls'), 'utf8').trim().split('\n').map(s => JSON.parse(s)); } catch { return []; } } };
}

describe('native plugin lifecycle', () => {
  test('normalizes metadata without exposing local paths and preserves installed state over available duplicates', () => {
    const result = parsePlugins({ available: [row], installed: [{ ...row, installed: true, enabled: false }] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: row.pluginId, installed: true, enabled: false });
    expect(JSON.stringify(result)).not.toContain('/private');
    expect(() => parsePlugins({ available: [row], installed: [row] })).toThrow('invalid');
    expect(() => parsePlugins({ available: [], installed: null })).toThrow('invalid');
  });

  test('lists, installs and removes through the configured native home, refreshing cached state', async () => {
    const { manager, home, calls } = fixture();
    const [a,b] = await Promise.all([manager.view(), manager.view()]);
    expect(a).toEqual(b);
    expect(calls()).toHaveLength(1);
    await manager.view();
    expect(calls()).toHaveLength(1);
    await manager.change(row.pluginId, 'install');
    expect(await manager.view()).toMatchObject({ state: 'available', plugins: [{ installed: true }] });
    await manager.change(row.pluginId, 'remove');
    expect(await manager.view()).toMatchObject({ state: 'available', plugins: [{ installed: false }] });
    for (const call of calls()) expect(call).toMatchObject({ home, codexHome: home });
    expect(calls().filter(c => c.args[1] !== 'list').map(c => c.args)).toEqual([
      ['plugin','add',row.pluginId,'--json'], ['plugin','remove',row.pluginId,'--json'],
    ]);
  });

  test('serializes conflicting changes and rechecks the native state before each mutation', async () => {
    const { manager, calls } = fixture();
    const results = await Promise.allSettled([manager.change(row.pluginId, 'install'), manager.change(row.pluginId, 'install')]);
    expect(results.map(r => r.status)).toEqual(['fulfilled','rejected']);
    expect(calls().filter(c => c.args[1] === 'add')).toHaveLength(1);
    await manager.change(row.pluginId, 'remove');
    expect(calls().filter(c => c.args[1] === 'remove')).toHaveLength(1);
  });

  test('rejects shell-like selectors, unknown plugins and marketplace-managed policy without mutating', async () => {
    const { manager, calls } = fixture('managed');
    await expect(manager.change('--all', 'remove')).rejects.toThrow('exact');
    await expect(manager.change('x@fixture;echo', 'install')).rejects.toThrow('exact');
    expect(calls()).toHaveLength(0);
    await expect(manager.change('unknown@fixture', 'install')).rejects.toThrow('no longer');
    await expect(manager.change(row.pluginId, 'install')).rejects.toThrow('policy');
    expect(calls().every(c => c.args[1] === 'list')).toBe(true);
  });

  for (const mode of ['wrong-id','unchanged']) test(`does not claim success for ${mode} native confirmation`, async () => {
    await expect(fixture(mode).manager.change(row.pluginId,'install')).rejects.toThrow('confirm');
  });
  for (const mode of ['failure','invalid']) test(`keeps ${mode} diagnostics private and reports an unavailable list`, async () => {
    const view = await fixture(mode).manager.view();
    expect(view.state).toBe('unavailable');
    expect(JSON.stringify(view)).not.toContain('private-token-fixture');
  });
  test('bounds a hung command and stops future requests after shutdown', async () => {
    const { manager } = fixture('hang');
    expect(await manager.view()).toMatchObject({ state: 'unavailable', message: expect.stringContaining('timed out') });
    await manager.stop();
    expect(await manager.view(true)).toMatchObject({ state: 'unavailable', message: expect.stringContaining('shutting down') });
  });
  test('discards an in-flight list when account or plugin configuration changes', async () => {
    const { manager } = fixture('slow-list');
    const pending = manager.view();
    manager.invalidate();
    expect(await pending).toMatchObject({ state:'unavailable',message:expect.stringContaining('changed') });
    expect(await manager.view()).toMatchObject({ state:'available' });
  });
  test('shutdown waits for active native children and rejects queued mutations', async () => {
    const { manager, calls } = fixture('hang');
    const pending = manager.view();
    for (let i=0; i<20 && !calls().length; i++) await Bun.sleep(10);
    expect(calls()).toHaveLength(1);
    const mutation = manager.change(row.pluginId, 'install').catch(error => error.message);
    await manager.stop();
    expect((await pending).state).toBe('unavailable');
    expect(await mutation).toContain('shutting down');
    expect(calls()).toHaveLength(1);
  });
});
