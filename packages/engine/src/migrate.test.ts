import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeConfig } from './data-dir.ts';
import { SOURCE_SERVICE_LABEL, folderProvider, parseInstallEnv, planMigration, runMigration, stopProcess, stopSourceService, waitUntilClosed } from './migrate.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-migrate-'));

describe('moving a source install to the app or the binary (ADR-0105)', () => {
  test("the installer's choices, as printf %q wrote them", () => {
    const env = parseInstallEnv("# written by the Foundry installer\nMODE=source\nDIR=/Users/me/My\\ Foundry\nHOST_DOCKER=''\nSERVICE=launchd\nNOTE=$'two\\nlines'\nbad line\n");
    expect(env).toEqual({ MODE: 'source', DIR: '/Users/me/My Foundry', HOST_DOCKER: '', SERVICE: 'launchd', NOTE: 'two\nlines' });
  });

  test('the plan: copy what the checkout holds, keep what Settings chose, leave a target that has data', () => {
    const checkout = '/Users/me/foundry';
    const has = new Set(['/Users/me/foundry/data', '/Users/me/foundry/data-codex', '/AS/Foundry/data-codex']);
    const plan = planMigration({
      checkout,
      config: HomeConfig.parse({ dataDirs: { agy: '/Volumes/Work/agy-data' } }),
      targetFor: (p) => `/AS/Foundry/${p === 'claude' ? 'data' : `data-${p}`}`,
      isFoundry: (p) => has.has(p),
    });
    expect(plan.map((i) => [i.provider, i.action])).toEqual([['claude', 'copy'], ['codex', 'done'], ['agy', 'keep']]);
    expect(plan[0]).toMatchObject({ from: '/Users/me/foundry/data', to: '/AS/Foundry/data' });
    expect(plan[2]!.why).toContain('opens it where it is');
    // a Settings choice inside the checkout says the checkout must stay
    const inside = planMigration({ checkout, config: HomeConfig.parse({ dataDirs: { claude: '/Users/me/foundry/data2' } }), targetFor: () => '/x', isFoundry: () => false });
    expect(inside[0]!.why).toContain('inside the checkout');
    expect(inside[1]!.action).toBe('none');
  });

  test('the copy points into itself, the original stays with a note', async () => {
    const root = tmp();
    try {
      const from = join(root, 'foundry', 'data');
      const to = join(root, 'Application Support', 'Foundry', 'data');
      mkdirSync(join(from, 'transcripts'), { recursive: true });
      writeFileSync(join(from, 'provider'), 'claude\n');
      writeFileSync(join(from, 'session-costs.json'), JSON.stringify({ file: `${from}/transcripts/a.jsonl` }));
      writeFileSync(join(from, 'transcripts', 'a.jsonl'), '{}\n');
      const said: string[] = [];
      const copied = await runMigration([{ provider: 'claude', from, to, action: 'copy', why: '' }, { provider: 'codex', from: '/nope', to: '', action: 'none', why: '' }], { log: (m) => said.push(m) });
      expect(copied.map((c) => c.provider)).toEqual(['claude']);
      expect(readFileSync(join(to, 'transcripts', 'a.jsonl'), 'utf8')).toBe('{}\n');
      expect(JSON.parse(readFileSync(join(to, 'session-costs.json'), 'utf8')).file).toBe(`${to}/transcripts/a.jsonl`);
      // the original is untouched but for the note
      expect(JSON.parse(readFileSync(join(from, 'session-costs.json'), 'utf8')).file).toBe(`${from}/transcripts/a.jsonl`);
      expect(readFileSync(join(from, 'MOVED.md'), 'utf8')).toContain(to);
      expect(said.join('\n')).toContain('copying');
      // a target that already holds data is refused by the folder test
      await expect(runMigration([{ provider: 'claude', from, to, action: 'copy', why: '' }], { log: () => {} })).rejects.toThrow(/cannot take the claude data/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("only the checkout's own service is stopped", async () => {
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      const agents = join(home, 'Library', 'LaunchAgents');
      mkdirSync(agents, { recursive: true });
      const plist = join(agents, `${SOURCE_SERVICE_LABEL}.plist`);
      const ran: string[][] = [];
      const run = async (argv: string[]) => (ran.push(argv), { code: 0, stdout: '' });
      // a compiled install's agent of the same name is not the checkout's
      writeFileSync(plist, `<plist><string>${home}/.local/share/foundry/releases/current/foundry</string><string>serve</string></plist>`);
      expect((await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'darwin', uid: 501 })).kind).toBe('none');
      expect(existsSync(plist)).toBe(true);
      writeFileSync(plist, `<plist><string>/opt/bun</string><string>apps/cli/src/main.ts</string><string>serve</string><key>WorkingDirectory</key><string>${checkout}</string></plist>`);
      const stopped = await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'darwin', uid: 501 });
      expect(stopped.kind).toBe('launchd');
      expect(ran).toEqual([['launchctl', 'bootout', `gui/501/${SOURCE_SERVICE_LABEL}`]]);
      // the agent's file stays until the copy is made: a failed copy starts the old Foundry again
      expect(existsSync(plist)).toBe(true);
      await stopped.restore();
      expect(ran[1]).toEqual(['launchctl', 'bootstrap', 'gui/501', plist]);
      // retired, not deleted: disabled so it never loads again, its file kept for the way back (ADR-0107)
      await stopped.retire();
      expect(ran[2]).toEqual(['launchctl', 'disable', `gui/501/${SOURCE_SERVICE_LABEL}`]);
      expect(existsSync(plist)).toBe(true);
      // systemd on Linux
      const unitDir = join(home, '.config', 'systemd', 'user');
      mkdirSync(unitDir, { recursive: true });
      writeFileSync(join(unitDir, 'foundry.service'), `[Service]\nWorkingDirectory=${checkout}\nExecStart=/usr/bin/bun apps/cli/src/main.ts serve\n`);
      ran.length = 0;
      const unit = await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'linux' });
      expect(unit.kind).toBe('systemd');
      expect(ran[0]).toEqual(['systemctl', '--user', 'stop', 'foundry.service']);
      await unit.retire();
      expect(ran.slice(1)).toEqual([['systemctl', '--user', 'disable', 'foundry.service']]);
      expect(existsSync(join(unitDir, 'foundry.service'))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the folder the switching engine runs on is the one copied, unless Settings chose it', () => {
    const has = new Set(['/elsewhere/data', '/Users/me/foundry/data']);
    const base = { checkout: '/Users/me/foundry', targetFor: () => '/AS/Foundry/data', isFoundry: (p: string) => has.has(p) };
    // FOUNDRY_DATA_DIR pointed elsewhere: that folder, not the checkout's own, is copied
    const env = planMigration({ ...base, config: HomeConfig.parse({}), current: { provider: 'claude', dataDir: '/elsewhere/data' } });
    expect(env[0]).toMatchObject({ provider: 'claude', from: '/elsewhere/data', to: '/AS/Foundry/data', action: 'copy' });
    // the folder Settings chose: opened where it is
    const chosen = planMigration({ ...base, config: HomeConfig.parse({ dataDirs: { claude: '/elsewhere/data' } }), current: { provider: 'claude', dataDir: '/elsewhere/data' } });
    expect(chosen[0]!.action).toBe('keep');
  });

  test('a folder knows its provider; a process is stopped and waited for', async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, 'provider'), 'codex\n');
      expect(folderProvider(dir)).toBe('codex');
      expect(folderProvider(join(dir, 'none'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    let calls = 0;
    expect(await stopProcess(4242, { alive: () => false })).toBe('gone');
    // a pid no process has: the signal is real, so never this test's own
    expect(await stopProcess(2 ** 22 + 777, { alive: () => ++calls < 3, sleep: async () => {} })).toBe('stopped');
  });

  test('waiting for the database to be let go, and naming who holds it after the wait', async () => {
    const dir = tmp();
    try {
      const db = join(dir, 'engine.db');
      writeFileSync(db, '');
      let calls = 0;
      const free = await waitUntilClosed([db], { run: async (argv) => (calls++, argv[0] === 'lsof' && calls < 3 ? { code: 0, stdout: '4242\n' } : { code: 1, stdout: '' }), sleep: async () => {} });
      expect(free).toBeNull();
      const held = await waitUntilClosed([db], { run: async (argv) => (argv[0] === 'lsof' ? { code: 0, stdout: '4242\n' } : { code: 0, stdout: 'bun apps/cli/src/main.ts serve' }), timeoutMs: 0, sleep: async () => {} });
      expect(held).toBe('pid 4242 (bun apps/cli/src/main.ts serve)');
      expect(await waitUntilClosed([join(dir, 'missing.db')])).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
