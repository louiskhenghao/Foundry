/** Runs in a child with an isolated PATH and native homes; never touches personal accounts. */
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

export async function checkAccountDiscovery(home: string, provider: 'claude' | 'codex') {
  const bin = join(home, 'bin', provider);
  const nativeHome = join(home, provider);
  mkdirSync(nativeHome, { recursive: true });
  writeFileSync(join(home, 'skills.json'), JSON.stringify({ version: 1, entries: [] }));
  writeFileSync(join(home, 'mcp.json'), JSON.stringify({ version: 1, entries: [] }));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), {
    provider: 'claude', dataDir: join(home, 'data'), catalogPath: join(home, 'skills.json'),
    claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'),
    claudeBin: undefined, codexBin: undefined, log: () => {},
  }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const account = async (force = false) => {
    const response = await app.request(`/api/accounts${force ? '?force=1' : ''}`);
    assert.equal(response.status, 200);
    return (await response.json()).accounts.find((a: { provider: string }) => a.provider === provider);
  };
  const post = (action: string) => app.request(`/api/auth/${action}?provider=${provider}`, { method: 'POST' });
  try {
    assert.equal((await account()).installed, false);
    // Install and sign in externally after Foundry is already running.
    writeFileSync(join(nativeHome, 'signed-in'), 'fixture');
    writeFileSync(bin, `#!${process.execPath}
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
const provider = ${JSON.stringify(provider)};
const home = provider === 'codex' ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR;
const state = home + '/signed-in';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(provider + ' fixture'); process.exit(0); }
if (args[0] === 'features' && args[1] === 'list') { console.log('hooks                 stable   true'); process.exit(0); }
if (args[0] === 'mcp') { console.log('[]'); process.exit(0); }
if (args[0] === 'app-server') {
  createInterface({input:process.stdin}).on('line', line => {
    const msg = JSON.parse(line);
    if (msg.id == null) return;
    const account = existsSync(state) ? {type:'chatgpt',email:'fixture@example.test',planType:'pro'} : null;
    const result = msg.method === 'account/read' ? {account} : msg.method === 'mcpServerStatus/list' ? {data:[],nextCursor:null} : {};
    console.log(JSON.stringify({id:msg.id,result}));
  });
} else if (args.includes('status')) {
  console.log(JSON.stringify({loggedIn:existsSync(state),authMethod:'claudeai'}));
} else if (args.includes('logout')) {
  rmSync(state, {force:true});
} else if (args.includes('login')) {
  writeFileSync(state, 'fixture');
} else process.exit(1);
`);
    chmodSync(bin, 0o755);
    const doctor = await (await app.request(`/api/doctor?provider=${provider}`)).json();
    assert.equal(doctor.checks.find((c: { id: string }) => c.id === `${provider}-bin`).ok, true);
    assert.equal(doctor.checks.find((c: { id: string }) => c.id === `${provider}-auth`).ok, true);
    const installed = await account();
    assert.equal(installed.installed, true);
    assert.equal(installed.status.loggedIn, true, `${provider}: Setup is signed in but Accounts says ${installed.status.error}`);
    assert.equal((await account(true)).status.loggedIn, true);
    const login = await post('login');
    assert.equal(login.status, 200, await login.text());
    const deadline = Date.now() + 4000;
    while (!engine.accounts[provider].loginSession()?.done && Date.now() < deadline) await Bun.sleep(10);
    assert.equal(engine.accounts[provider].loginSession()?.ok, true);
    assert.equal((await post('logout')).status, 200);
    assert.equal(existsSync(join(nativeHome, 'signed-in')), false);
    assert.equal((await account()).status.loggedIn, false);
    rmSync(bin);
    const removed = await account();
    assert.equal(removed.installed, false);
    assert.equal(removed.status.error, `${provider} not installed`);
    const missing = await post('login');
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, `${provider} CLI not installed`);
  } finally {
    await engine.stop();
  }
}
