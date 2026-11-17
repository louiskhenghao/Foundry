import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeProbe, seedCheckout, seedFolder, tmp } from './test-helpers.ts';
import { countFolder, type EarlierInstall } from './find.ts';
import { finishMove, readMovedFrom } from './finish.ts';
import { carriedLeaves, HANDOFF_FILE, mapWorktreeLinks, MoveError, pathMap, planMove, runMove, STAGING_SUFFIX, swapIn, swapOut, verifyCopy } from './move.ts';

const source = (where: string, over: Partial<EarlierInstall> = {}): EarlierInstall => ({
  id: `source:${where}`,
  kind: 'source',
  where,
  version: '2.35.0',
  recorded: false,
  running: null,
  port: null,
  url: null,
  folders: [{ provider: 'claude', path: join(where, 'data'), counts: countFolder(join(where, 'data')), moved: false, chosen: false }],
  goals: countFolder(join(where, 'data'))?.goals ?? 0,
  last: null,
  env: {},
  docker: null,
  ...over,
});
const quiet = () => {};
const noSleep = async () => {};

describe('what a move would do (ADR-0107)', () => {
  test("into an empty place it copies; over this install's folder with no goals it sets that aside; with goals only when asked", () => {
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 3);
      const target = join(home, 'app', 'data');
      const plan = (replace?: boolean) => planMove(source(checkout), { targetFor: () => target, replace });
      expect(plan()[0]).toMatchObject({ action: 'copy', from: join(checkout, 'data'), to: target });
      // the folder the app made when it first opened: no goals, set aside
      seedFolder(target, 0);
      expect(plan()[0]).toMatchObject({ action: 'replace', why: 'this install has no goals yet: its folder is set aside' });
      rmSync(target, { recursive: true });
      seedFolder(target, 2);
      expect(plan()[0]).toMatchObject({ action: 'conflict', why: 'this install already has 2 goals' });
      expect(plan(true)[0]).toMatchObject({ action: 'replace', why: "this install's 2 goals are set aside as a backup" });
      // a folder chosen in Settings is opened where it is
      const chosen = planMove(source(checkout, { folders: [{ provider: 'claude', path: '/Volumes/x/data', counts: null, moved: false, chosen: true }] }), { targetFor: () => target });
      expect(chosen[0]).toMatchObject({ action: 'keep', from: '/Volumes/x/data', to: '/Volumes/x/data' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a container's paths map back to this computer's, and only settings that mean something here are carried", () => {
    const docker: EarlierInstall = {
      ...source('/x'),
      id: 'docker:foundry',
      kind: 'docker',
      where: 'foundry',
      env: { FOUNDRY_MAX_CONCURRENT: '5', FOUNDRY_CODEX_HOME: '/home/node/.codex', FOUNDRY_WORKSPACES_ROOT: '/repos/ws', HINDSIGHT_API_URL: 'http://hindsight:8888', FOUNDRY_PORT: '4111' },
      docker: { container: 'foundry', image: 'imlouiskhenghao/foundry:2.36.0', imageId: 'sha256:a', restart: 'unless-stopped', composeDir: null, watchtower: null, mounts: [{ type: 'volume', name: 'engine-data', source: '/var/lib/docker/volumes/x', destination: '/app/data' }, { type: 'bind', name: null, source: '/Users/me/Projects', destination: '/repos' }, { type: 'bind', name: null, source: '/Users/me/Projects', destination: '/Users/me/Projects' }] },
    };
    const map = pathMap(docker, [{ provider: 'claude', from: '/app/data', to: '/Users/me/Library/Application Support/Foundry/data', action: 'copy', why: '', counts: null }]);
    expect(map).toEqual([
      ['/app/data', '/Users/me/Library/Application Support/Foundry/data'],
      ['/repos', '/Users/me/Projects'],
    ]);
    expect(carriedLeaves(docker, map)).toEqual({ 'engine.maxConcurrent': 5, 'engine.workspacesRoot': '/Users/me/Projects/ws', 'memory.url': 'http://127.0.0.1:8888' });
  });

  test("each worktree's link to its repository is mapped the same way", () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, 'worktrees', 'g_1', '_goal'), { recursive: true });
      writeFileSync(join(dir, 'worktrees', 'g_1', '_goal', '.git'), 'gitdir: /repos/app/.git/worktrees/_goal\n');
      mkdirSync(join(dir, 'providers', 'codex', 'worktrees', 'g_2', 't_1'), { recursive: true });
      writeFileSync(join(dir, 'providers', 'codex', 'worktrees', 'g_2', 't_1', '.git'), 'gitdir: /Users/me/Projects/web/.git/worktrees/t_1\n');
      expect(mapWorktreeLinks(dir, [['/repos', '/Users/me/Projects']])).toBe(1);
      expect(readFileSync(join(dir, 'worktrees', 'g_1', '_goal', '.git'), 'utf8')).toBe('gitdir: /Users/me/Projects/app/.git/worktrees/_goal\n');
      expect(readFileSync(join(dir, 'providers', 'codex', 'worktrees', 'g_2', 't_1', '.git'), 'utf8')).toBe('gitdir: /Users/me/Projects/web/.git/worktrees/t_1\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a swap is all or none, and can be taken back", () => {
    const dir = tmp();
    try {
      const target = join(dir, 'data');
      seedFolder(target, 0);
      seedFolder(target + STAGING_SUFFIX, 4);
      const staged = [{ provider: 'claude' as const, staging: target + STAGING_SUFFIX, target }];
      const aside = swapIn(staged, quiet, '20261117-120000');
      expect(aside).toEqual([`${target}.before-move-20261117-120000`]);
      expect(countFolder(target)?.goals).toBe(4);
      swapOut(staged, aside);
      expect(countFolder(target)?.goals).toBe(0);
      expect(countFolder(target + STAGING_SUFFIX)?.goals).toBe(4);
      // a second folder that cannot be put in place takes back the first
      const broken = [...staged, { provider: 'codex' as const, staging: join(dir, 'nowhere'), target: join(dir, 'data-codex') }];
      expect(() => swapIn(broken, quiet, 'x')).toThrow();
      expect(countFolder(target)?.goals).toBe(0);
      expect(countFolder(target + STAGING_SUFFIX)?.goals).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a copy that does not hold what the original held is refused', () => {
    const dir = tmp();
    try {
      seedFolder(join(dir, 'a'), 2);
      expect(verifyCopy(join(dir, 'a'), { goals: 2, events: 2, last: null }).goals).toBe(2);
      expect(() => verifyCopy(join(dir, 'a'), { goals: 3, events: 3, last: null })).toThrow(MoveError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a move from a checkout (ADR-0107)', () => {
  test('the copy takes the place of the folder the app made, with its settings, and the old one keeps a note', async () => {
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 3);
      mkdirSync(join(checkout, 'data', 'worktrees', 'g_0', '_goal'), { recursive: true });
      writeFileSync(join(checkout, 'data', 'worktrees', 'g_0', '_goal', '.git'), 'gitdir: /Users/me/Projects/app/.git/worktrees/_goal\n');
      writeFileSync(join(checkout, 'data', 'engine.pid'), JSON.stringify({ pid: 1, port: 4111, startedAt: '' }));
      const target = join(home, 'app', 'data');
      seedFolder(target, 0);
      const install = source(checkout, { env: { FOUNDRY_MAX_CONCURRENT: '5' } });
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'lsof' || argv[0] === 'ps' ? { code: 1, stdout: '', stderr: '' } : null) });
      const said: string[] = [];
      const done = await runMove({ install, items: planMove(install, { targetFor: () => target }), swap: true, log: (m) => said.push(m), probe, sleep: noSleep });
      expect(done.goals).toBe(3);
      expect(countFolder(target)?.goals).toBe(3);
      expect(done.setAside).toHaveLength(1);
      expect(countFolder(done.setAside[0]!)?.goals).toBe(0);
      expect(existsSync(target + STAGING_SUFFIX)).toBe(false);
      // the old engine's lock is not the copy's; the handoff is there for the engine that opens it
      expect(existsSync(join(target, 'engine.pid'))).toBe(false);
      expect(JSON.parse(readFileSync(join(target, HANDOFF_FILE), 'utf8'))).toMatchObject({ from: { kind: 'source', where: checkout }, goals: 3, carried: ['engine.maxConcurrent'] });
      expect(JSON.parse(readFileSync(join(target, 'settings.json'), 'utf8'))).toEqual({ engine: { maxConcurrent: 5 } });
      // the original is the backup, untouched but for its note
      expect(countFolder(join(checkout, 'data'))?.goals).toBe(3);
      expect(readFileSync(join(checkout, 'data', 'MOVED.md'), 'utf8')).toContain('bun run serve');
      expect(said.some((m) => m.startsWith('checked: 3 goals'))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a copy that fails changes nothing here, and the old one starts again its own way', async () => {
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 2);
      const agents = join(home, 'Library', 'LaunchAgents');
      mkdirSync(agents, { recursive: true });
      writeFileSync(join(agents, 'dev.foundry.server.plist'), `<plist><string>apps/cli/src/main.ts</string><string>${checkout}</string></plist>`);
      const target = join(home, 'app', 'data');
      seedFolder(target, 0);
      const install = source(checkout);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'cp' ? { code: 1, stdout: '', stderr: 'cp: disk full' } : argv[0] === 'launchctl' ? { code: 0, stdout: '', stderr: '' } : argv[0] === 'lsof' || argv[0] === 'ps' ? { code: 1, stdout: '', stderr: '' } : null) });
      await expect(runMove({ install, items: planMove(install, { targetFor: () => target }), swap: true, log: quiet, probe, sleep: noSleep })).rejects.toThrow(/disk full/);
      expect(countFolder(target)?.goals).toBe(0);
      expect(existsSync(target + STAGING_SUFFIX)).toBe(false);
      expect(existsSync(join(checkout, 'data', 'MOVED.md'))).toBe(false);
      const launchctl = probe.ran.filter((a) => a[0] === 'launchctl').map((a) => a[1]);
      expect(launchctl).toEqual(['bootout', 'bootstrap']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('goals at work there are paused first, waited for, and handed over to resume here', async () => {
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 1);
      const target = join(home, 'app', 'data');
      const install = source(checkout, { url: 'http://127.0.0.1:4111', running: { pid: null, how: 'process' } });
      let calls = 0;
      const posted: string[] = [];
      const probe = fakeProbe({
        home,
        run: (argv) => (argv[0] === 'lsof' || argv[0] === 'ps' ? { code: 1, stdout: '', stderr: '' } : null),
        json: (url, init) => {
          if (init?.method === 'POST') return (posted.push(url), { ok: true });
          if (url.endsWith('/api/goals')) return [{ id: 'g_0', title: 'goal 0', state: calls++ < 2 ? 'running' : 'paused' }];
          if (url.endsWith('/api/health')) return { busy: { total: calls < 3 ? 1 : 0 } };
          return null;
        },
      });
      const done = await runMove({ install, items: planMove(install, { targetFor: () => target }), swap: true, log: quiet, probe, sleep: noSleep });
      expect(done.paused).toEqual(['g_0']);
      expect(posted).toEqual(['http://127.0.0.1:4111/api/goals/g_0/pause']);
      expect(JSON.parse(readFileSync(join(target, HANDOFF_FILE), 'utf8')).paused).toEqual(['g_0']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the first start on a moved copy (ADR-0107)', () => {
  test('its worktrees are linked to their repositories again, the paused goals resume, and the page gets a record', async () => {
    const dir = tmp();
    try {
      seedFolder(dir, 1);
      mkdirSync(join(dir, 'worktrees', 'g_0', '_goal'), { recursive: true });
      writeFileSync(join(dir, 'worktrees', 'g_0', '_goal', '.git'), 'gitdir: /nowhere/.git/worktrees/_goal\n');
      writeFileSync(join(dir, HANDOFF_FILE), JSON.stringify({ from: { kind: 'source', where: '/old', version: '2.35.0', folder: '/old/data' }, at: 'x', paused: ['g_0'], goals: 1, events: 1, carried: [], pathMap: [] }));
      const resumed: string[] = [];
      const probe = fakeProbe({ home: dir, run: (argv) => (argv[0] === 'git' ? { code: 0, stdout: '', stderr: '' } : null) });
      const record = await finishMove({ dataDir: dir, resume: async (id) => void resumed.push(id), log: quiet, probe });
      expect(resumed).toEqual(['g_0']);
      expect(probe.ran.filter((a) => a[0] === 'git')).toEqual([['git', '-C', join(dir, 'worktrees', 'g_0', '_goal'), 'worktree', 'repair']]);
      expect(record).toMatchObject({ repaired: 1, unrepaired: [], from: { where: '/old' } });
      expect(existsSync(join(dir, HANDOFF_FILE))).toBe(false);
      expect(readMovedFrom(dir)?.goals).toBe(1);
      // once only
      expect(await finishMove({ dataDir: dir, resume: async () => {}, log: quiet, probe })).toBeNull();
      expect(readdirSync(dir)).toContain('moved-from.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the move the page asks for (ADR-0107)', () => {
  test("goals made with Codex move into a fresh app on Codex's launch profile; over goals of the app's own, nothing stops", async () => {
    const { Mover } = await import('./mover.ts');
    const home = tmp();
    try {
      // a checkout that ran on Codex's profile, with the empty folder of Claude Code's beside it
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 0);
      seedFolder(join(checkout, 'data-codex'), 3);
      writeFileSync(join(checkout, 'data-codex', 'provider'), 'codex');
      const mine = join(home, 'app', 'data');
      seedFolder(mine, 0);
      const theirs = join(home, 'app', 'data-codex');
      mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), `MODE=source\nDIR=${checkout}\nPORT=4199\n`);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'docker' ? { code: 127, stdout: '', stderr: '' } : argv[0] === 'ps' || argv[0] === 'lsof' ? { code: 1, stdout: '', stderr: '' } : null) });
      let goalsHere = 2;
      const asked: unknown[] = [];
      const lines: string[] = [];
      const mover = new Mover({ kind: 'app', dataDir: () => mine, targetFor: (p) => (p === 'codex' ? theirs : mine), provider: () => 'claude', goals: () => goalsHere, port: () => 4112, restart: (r) => void asked.push(r), log: quiet, probe, restartAfterMs: 0 });
      // the app has goals of its own on Claude Code's profile: refused before the old one stops or anything is copied
      const refused = mover.start({ id: `source:${checkout}`, onLine: quiet });
      for (let i = 0; i < 200 && refused.state === 'running'; i++) await Bun.sleep(10);
      expect(refused.state).toBe('failed');
      expect(refused.error).toContain("Codex's launch profile");
      expect(asked).toEqual([]);
      expect(existsSync(theirs + STAGING_SUFFIX)).toBe(false);
      expect(existsSync(theirs + '.moving.json')).toBe(false);
      // a fresh app: the copy is staged where it keeps Codex's data, and it starts again on Codex's profile. Named by
      // path, as foundry migrate --from asks a running app, it moves the folders the search found, not only data/
      goalsHere = 0;
      const job = mover.start({ id: `source:${checkout}`, from: checkout, onLine: (l) => lines.push(l) });
      for (let i = 0; i < 200 && !asked.length; i++) await Bun.sleep(10);
      expect(job.state).toBe('restarting');
      expect(asked[0]).toMatchObject({ kind: 'move', profile: 'codex' });
      expect((asked[0] as { staged: { provider: string; target: string }[] }).staged).toContainEqual({ provider: 'codex', staging: theirs + STAGING_SUFFIX, target: theirs });
      expect(countFolder(theirs + STAGING_SUFFIX)?.goals).toBe(3);
      expect(lines).toContain("Foundry runs Codex's launch profile from now on: the goals were made with it");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('an app with no goals offers it; the job copies while this engine serves, then asks the serve loop to swap', async () => {
    const { Mover } = await import('./mover.ts');
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 2);
      const target = join(home, 'app', 'data');
      seedFolder(target, 0);
      mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), `MODE=source\nDIR=${checkout}\nPORT=4199\n`);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'docker' ? { code: 127, stdout: '', stderr: '' } : argv[0] === 'ps' || argv[0] === 'lsof' ? { code: 1, stdout: '', stderr: '' } : null) });
      const asked: unknown[] = [];
      const lines: string[] = [];
      const mover = new Mover({ kind: 'app', dataDir: () => target, targetFor: () => target, provider: () => 'claude', goals: () => 0, port: () => 4112, restart: (r) => void asked.push(r), log: quiet, probe, restartAfterMs: 0 });
      const status = await mover.status();
      expect(status.offer).toBe(true);
      expect(status.installs[0]).toMatchObject({ id: `source:${checkout}`, goals: 2, plan: [{ action: 'replace' }] });
      const job = mover.start({ id: `source:${checkout}`, onLine: (l) => lines.push(l) });
      expect(() => mover.start({ id: `source:${checkout}`, onLine: quiet })).toThrow('a move is under way');
      for (let i = 0; i < 200 && !asked.length; i++) await Bun.sleep(10);
      expect(job.state).toBe('restarting');
      // where it answers next was known before anything stopped: the old one's port, free here
      expect(job.nextUrl).toBe('http://127.0.0.1:4199');
      expect(asked).toEqual([{ kind: 'move', staged: [{ provider: 'claude', staging: target + STAGING_SUFFIX, target }], port: expect.anything(), profile: null }]);
      // the old one is untouched until the copy runs here: no note in its folder yet, and a record that a move is under way
      expect(existsSync(join(checkout, 'data', 'MOVED.md'))).toBe(false);
      expect(existsSync(target + '.moving.json')).toBe(true);
      // staged beside this install's folder, which this engine still has open
      expect(countFolder(target + STAGING_SUFFIX)?.goals).toBe(2);
      expect(countFolder(target)?.goals).toBe(0);
      expect(lines.some((l) => l.startsWith('starting again on the moved data'))).toBe(true);
      // a checkout never offers one
      expect((await new Mover({ kind: 'checkout', dataDir: () => target, targetFor: () => target, provider: () => 'claude', goals: () => 0, port: () => 4111, restart: () => {}, log: quiet, probe }).status()).offer).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('a move that has not run here yet (ADR-0107)', () => {
  test("a move from the page leaves the old install as it is until its copy runs; the first start retires it", async () => {
    const { MOVING_SUFFIX } = await import('./move.ts');
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 2);
      const agents = join(home, 'Library', 'LaunchAgents');
      mkdirSync(agents, { recursive: true });
      writeFileSync(join(agents, 'dev.foundry.server.plist'), `<plist><string>apps/cli/src/main.ts</string><string>${checkout}</string></plist>`);
      const target = join(home, 'app', 'data');
      const install = source(checkout);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'launchctl' ? { code: 0, stdout: '', stderr: '' } : argv[0] === 'lsof' || argv[0] === 'ps' ? { code: 1, stdout: '', stderr: '' } : null) });
      const done = await runMove({ install, items: planMove(install, { targetFor: () => target }), swap: false, log: quiet, probe, sleep: noSleep });
      expect(done.old?.service).toMatchObject({ how: 'launchd' });
      // stopped, not retired: no note, no disable, a record of the move in progress
      expect(existsSync(join(checkout, 'data', 'MOVED.md'))).toBe(false);
      expect(probe.ran.filter((a) => a[0] === 'launchctl').map((a) => a[1])).toEqual(['bootout']);
      expect(JSON.parse(readFileSync(target + MOVING_SUFFIX, 'utf8')).old).toMatchObject({ where: checkout, folders: [{ from: join(checkout, 'data'), to: target }] });
      // the serve loop swaps it in; the first start finishes: the old one retires, the installer's record follows
      swapIn(done.staged, quiet);
      const adopted: string[] = [];
      await finishMove({ dataDir: target, resume: async () => {}, log: quiet, probe, adopt: async () => void adopted.push('yes') });
      expect(readFileSync(join(checkout, 'data', 'MOVED.md'), 'utf8')).toContain('delete this note');
      expect(probe.ran.filter((a) => a[0] === 'launchctl').map((a) => a[1])).toEqual(['bootout', 'disable']);
      expect(adopted).toEqual(['yes']);
      expect(existsSync(target + MOVING_SUFFIX)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a move cut off before its copy ran is undone by the next start: the old one runs again, the half copy goes', async () => {
    const { recoverInterruptedMoves, MOVING_SUFFIX } = await import('./move.ts');
    const home = tmp();
    try {
      const target = join(home, 'app', 'data');
      mkdirSync(target + STAGING_SUFFIX, { recursive: true });
      writeFileSync(target + MOVING_SUFFIX, JSON.stringify({ old: { kind: 'source', where: '/old', version: null, folders: [{ from: '/old/data', to: target }], service: { how: 'launchd', domain: 'gui/501', label: 'dev.foundry.server', plist: '/p.plist' }, url: null, paused: [], restart: null } }));
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'launchctl' ? { code: 0, stdout: '', stderr: '' } : null) });
      expect(await recoverInterruptedMoves([target], { probe, log: quiet })).toBe(1);
      expect(probe.ran).toContainEqual(['launchctl', 'bootstrap', 'gui/501', '/p.plist']);
      expect(existsSync(target + STAGING_SUFFIX)).toBe(false);
      expect(existsSync(target + MOVING_SUFFIX)).toBe(false);
      // swapped in already: the copy's first start finishes that one, nothing to undo
      seedFolder(target, 1);
      writeFileSync(join(target, HANDOFF_FILE), '{}');
      writeFileSync(target + MOVING_SUFFIX, '{}');
      expect(await recoverInterruptedMoves([target], { probe, log: quiet })).toBe(0);
      expect(existsSync(target + MOVING_SUFFIX)).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a goal made here while the move waited: the move stops and the old one runs again', async () => {
    const { Mover } = await import('./mover.ts');
    const home = tmp();
    try {
      const checkout = join(home, 'foundry');
      seedCheckout(checkout, 2);
      const target = join(home, 'app', 'data');
      seedFolder(target, 0);
      mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), `MODE=source\nDIR=${checkout}\n`);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'docker' ? { code: 127, stdout: '', stderr: '' } : argv[0] === 'ps' || argv[0] === 'lsof' ? { code: 1, stdout: '', stderr: '' } : null) });
      let goalsHere = 0;
      const asked: unknown[] = [];
      const mover = new Mover({ kind: 'app', dataDir: () => target, targetFor: () => target, provider: () => 'claude', goals: () => goalsHere, port: () => 4112, restart: (r) => void asked.push(r), log: quiet, probe, restartAfterMs: 0 });
      const job = mover.start({ id: `source:${checkout}`, onLine: () => void (goalsHere = 1) });
      for (let i = 0; i < 200 && job.state === 'running'; i++) await Bun.sleep(10);
      expect(job.state).toBe('failed');
      expect(job.error).toContain('made while the move ran');
      expect(asked).toEqual([]);
      expect(existsSync(target + STAGING_SUFFIX)).toBe(false);
      expect(existsSync(join(checkout, 'data', 'MOVED.md'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
