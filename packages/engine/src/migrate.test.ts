import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HomeConfig } from './data-dir.ts';
import { SOURCE_SERVICE_LABEL, parseInstallEnv, planMigration, runMigration, stopSourceService, waitUntilClosed } from './migrate.ts';

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
      expect(await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'darwin', uid: 501 })).toBe('none');
      expect(existsSync(plist)).toBe(true);
      writeFileSync(plist, `<plist><string>/opt/bun</string><string>apps/cli/src/main.ts</string><string>serve</string><key>WorkingDirectory</key><string>${checkout}</string></plist>`);
      expect(await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'darwin', uid: 501 })).toBe('launchd');
      expect(ran).toEqual([['launchctl', 'bootout', `gui/501/${SOURCE_SERVICE_LABEL}`]]);
      expect(existsSync(plist)).toBe(false);
      // systemd on Linux
      const unitDir = join(home, '.config', 'systemd', 'user');
      mkdirSync(unitDir, { recursive: true });
      writeFileSync(join(unitDir, 'foundry.service'), `[Service]\nWorkingDirectory=${checkout}\nExecStart=/usr/bin/bun apps/cli/src/main.ts serve\n`);
      ran.length = 0;
      expect(await stopSourceService({ checkout, home, env: {}, run, log: () => {}, platform: 'linux' })).toBe('systemd');
      expect(ran[0]).toEqual(['systemctl', '--user', 'disable', '--now', 'foundry.service']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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
