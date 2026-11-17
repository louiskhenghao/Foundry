import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutOf, containerFacts, findEarlierInstalls, isCheckoutServe, listenPort, lsofNames, parseDotenv, parsePs, parseUnit } from './find.ts';
import type { RunResult } from './probe.ts';
import { fakeProbe, seedCheckout, seedFolder, tmp } from './test-helpers.ts';

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

describe('reading what runs on a computer', () => {
  test('ps lines, a checkout server, the checkout it runs from', () => {
    expect(parsePs('  123 bun --watch apps/cli/src/main.ts serve\n 77 /usr/sbin/sshd\n')).toEqual([
      { pid: 123, command: 'bun --watch apps/cli/src/main.ts serve' },
      { pid: 77, command: '/usr/sbin/sshd' },
    ]);
    expect(isCheckoutServe('bun --watch apps/cli/src/main.ts serve')).toBe(true);
    expect(isCheckoutServe('/opt/bun /home/me/foundry/apps/cli/src/main.ts serve --x')).toBe(true);
    // the CLI of a checkout, or anything else that serves, is not a Foundry server
    expect(isCheckoutServe('bun apps/cli/src/main.ts ask g_1 hi')).toBe(false);
    expect(isCheckoutServe('python -m http.server serve')).toBe(false);
    expect(checkoutOf('bun --watch apps/cli/src/main.ts serve', '/Users/me/foundry')).toBe('/Users/me/foundry');
    expect(checkoutOf('/opt/bun /srv/foundry/apps/cli/src/main.ts serve', null)).toBe('/srv/foundry');
    expect(checkoutOf('bun apps/cli/src/main.ts serve', null)).toBeNull();
    expect(lsofNames('p123\nfcwd\nn/Users/me/foundry\n')).toEqual(['/Users/me/foundry']);
    expect(listenPort(['*:4111'])).toBe(4111);
    expect(listenPort(['127.0.0.1:4312'])).toBe(4312);
    expect(listenPort([])).toBeNull();
  });

  test('a slim Linux with no ps: the processes are read from /proc', async () => {
    const { listProcesses, commandOf } = await import('./find.ts');
    const probe = fakeProbe({ home: '/x', platform: 'linux', run: (argv) => (argv[0] === 'ps' ? { code: 127, stdout: '', stderr: '' } : argv[0] === 'sh' ? ok('1 /sbin/init \n42 bun apps/cli/src/main.ts serve \n43 \n') : null) });
    expect(await listProcesses(probe)).toEqual([
      { pid: 1, command: '/sbin/init' },
      { pid: 42, command: 'bun apps/cli/src/main.ts serve' },
    ]);
    expect(await commandOf(probe, 999999)).toBe('');
  });

  test('a .env and a systemd unit', () => {
    expect(parseDotenv('# a comment\nexport FOUNDRY_MAX_CONCURRENT=5\nFOUNDRY_MODEL_CHEAP="haiku" \nHINDSIGHT_API_URL=http://hindsight:8888 # memory\n')).toEqual({ FOUNDRY_MAX_CONCURRENT: '5', FOUNDRY_MODEL_CHEAP: 'haiku', HINDSIGHT_API_URL: 'http://hindsight:8888' });
    expect(parseUnit('[Service]\nWorkingDirectory=/home/me/foundry\nExecStart=/usr/bin/bun apps/cli/src/main.ts serve\nEnvironment="FOUNDRY_PORT=4111" FOUNDRY_PROVIDER=claude\n')).toEqual({ dir: '/home/me/foundry', exec: '/usr/bin/bun apps/cli/src/main.ts serve', env: { FOUNDRY_PORT: '4111', FOUNDRY_PROVIDER: 'claude' } });
  });

  test("a container is Foundry's by its image, or by its /app/data, never by its name alone", () => {
    const inspect = (image: string, mounts: { Type: string; Name?: string; Source: string; Destination: string }[]) => ({ Name: '/foundry', Image: 'sha256:abc', Config: { Image: image, Labels: { 'com.docker.compose.project': 'foundry', 'com.docker.compose.project.working_dir': '/Users/me/foundry' } }, State: { Running: true }, HostConfig: { RestartPolicy: { Name: 'unless-stopped' } }, NetworkSettings: { Ports: { '4111/tcp': [{ HostIp: '127.0.0.1', HostPort: '4111' }] } }, Mounts: mounts });
    // Docker Desktop on a Mac names a bind mount's source as its VM sees it
    const seen = containerFacts(inspect('imlouiskhenghao/foundry:latest', [{ Type: 'volume', Name: 'foundry_engine-data', Source: '/var/lib/docker/volumes/foundry_engine-data/_data', Destination: '/app/data' }, { Type: 'bind', Source: '/host_mnt/Users/me/Projects', Destination: '/repos' }]))!;
    expect(seen.facts.mounts[1]).toMatchObject({ source: '/Users/me/Projects', destination: '/repos' });
    expect(seen.running).toBe(true);
    expect(seen.port).toBe(4111);
    expect(seen.facts).toMatchObject({ container: 'foundry', image: 'imlouiskhenghao/foundry:latest', imageId: 'sha256:abc', restart: 'unless-stopped', composeDir: '/Users/me/foundry' });
    expect(seen.folders).toEqual([{ provider: 'claude', path: '/app/data' }]);
    // a goal's project that only took a name like Foundry's
    expect(containerFacts(inspect('postgres:16', [{ Type: 'volume', Name: 'db', Source: '/x', Destination: '/var/lib/postgresql/data' }]))).toBeNull();
  });
});

describe('finding the earlier installs (ADR-0107)', () => {
  test('the one with goals that runs by hand, the container, and the recorded one with none, in that order', async () => {
    const home = tmp();
    try {
      const recorded = join(home, 'foundry');
      const dev = join(home, 'Projects', 'my-foundry');
      seedCheckout(recorded, 0, '1.0.1');
      seedCheckout(dev, 3);
      writeFileSync(join(dev, '.env'), 'FOUNDRY_MAX_CONCURRENT=5\nFOUNDRY_PORT=4111\n');
      mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), `MODE=source\nDIR=${recorded}\nPORT=4111\n`);
      // this install's own folder: never an earlier install's
      const mine = join(home, 'Library', 'Application Support', 'Foundry', 'data');
      seedFolder(mine, 0);
      const probe = fakeProbe({
        home,
        run: (argv) => {
          const a = argv.join(' ');
          if (a.startsWith('ps -axo')) return ok(`  4242 bun --watch apps/cli/src/main.ts serve\n  4243 bun apps/cli/src/main.ts ask g_1 hi\n  99 /usr/sbin/sshd\n`);
          if (a === 'lsof -a -p 4242 -d cwd -Fn') return ok(`p4242\nfcwd\nn${dev}\n`);
          if (a === 'lsof -a -p 4242 -Fn') return ok(`p4242\nn${dev}/data/engine.db\nn${dev}/data/engine.db-wal\n`);
          if (a === 'lsof -a -p 4242 -iTCP -sTCP:LISTEN -Fn -P') return ok('p4242\nn*:4111\n');
          if (a.startsWith('docker version')) return ok('27.0.1\n');
          if (a.startsWith('docker ps -a --no-trunc')) return ok('c1\tfoundry\timlouiskhenghao/foundry:2.36.0\nc2\tfoundry-shop-db-1\tpostgres:16\n');
          if (a === 'docker inspect c1') return ok(JSON.stringify([{ Name: '/foundry', Image: 'sha256:abc', Config: { Image: 'imlouiskhenghao/foundry:2.36.0', Labels: {} }, State: { Running: false }, HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, PortBindings: { '4111/tcp': [{ HostPort: '4115' }] } }, Mounts: [{ Type: 'volume', Name: 'engine-data', Source: '/v', Destination: '/app/data' }, { Type: 'volume', Name: 'codex-data', Source: '/w', Destination: '/app/data-codex' }] }]));
          if (argv[0] === 'docker' && argv[1] === 'run') return ok(JSON.stringify({ '/app/data': { goals: 7, events: 70, last: '2026-11-01T00:00:00.000Z' }, '/app/data-codex': 'none' }) + '\n');
          return null;
        },
        json: (url) => (url === 'http://127.0.0.1:4111/api/health' ? { ok: true } : null),
      });
      const found = await findEarlierInstalls({ probe, exclude: [mine] });
      expect(found.installs.map((i) => [i.id, i.goals, !!i.running])).toEqual([
        [`source:${dev}`, 3, true],
        ['docker:foundry', 7, false],
        [`source:${recorded}`, 0, false],
      ]);
      const [devInstall, docker, old] = found.installs;
      expect(devInstall).toMatchObject({ version: '2.35.0', recorded: false, running: { pid: 4242, how: 'process' }, port: 4111, url: 'http://127.0.0.1:4111' });
      // what it read from its .env and may carry; the port is never carried
      expect(devInstall!.env).toEqual({ FOUNDRY_MAX_CONCURRENT: '5' });
      expect(docker).toMatchObject({ version: '2.36.0', port: 4115, url: null, docker: { container: 'foundry', imageId: 'sha256:abc', restart: 'unless-stopped' } });
      // the codex volume the image always mounts held no database: not a folder to move (found moving a real container)
      expect(docker!.folders.map((f) => f.path)).toEqual(['/app/data']);
      expect(docker!.folders[0]!.moved).toBe(false);
      // a stopped container is counted beside its volumes, with the image it already has
      expect(probe.ran.find((a) => a[1] === 'run')).toEqual(expect.arrayContaining(['--volumes-from', 'foundry', 'sha256:abc']));
      expect(old).toMatchObject({ recorded: true, goals: 0, version: '1.0.1' });
      // the goal project's postgres was never looked at
      expect(probe.ran.some((a) => a.includes('c2'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a folder with a MOVED.md went elsewhere: its goals are not counted, and Docker missing is not an error', async () => {
    const home = tmp();
    try {
      const dir = join(home, 'foundry');
      seedCheckout(dir, 2);
      writeFileSync(join(dir, 'data', 'MOVED.md'), '# moved');
      mkdirSync(join(home, '.config', 'foundry'), { recursive: true });
      writeFileSync(join(home, '.config', 'foundry', 'install.env'), `MODE=source\nDIR=${dir}\n`);
      const probe = fakeProbe({ home, run: (argv) => (argv[0] === 'docker' ? { code: 127, stdout: '', stderr: '' } : argv[0] === 'ps' ? ok('') : null) });
      const found = await findEarlierInstalls({ probe });
      expect(found.installs).toHaveLength(1);
      expect(found.installs[0]).toMatchObject({ goals: 0 });
      expect(found.installs[0]!.folders[0]).toMatchObject({ moved: true });
      expect(found.notes).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test('a container that moved already keeps its MOVED.md: its goals are not offered again', async () => {
  const home = tmp();
  try {
    const probe = fakeProbe({
      home,
      run: (argv) => {
        const a = argv.join(' ');
        if (argv[0] === 'ps') return ok('');
        if (a.startsWith('docker version')) return ok('27.0.1\n');
        if (a.startsWith('docker ps -a --no-trunc')) return ok('c1\tfoundry\timlouiskhenghao/foundry:2.36.0\n');
        if (a === 'docker inspect c1') return ok(JSON.stringify([{ Name: '/foundry', Image: 'sha256:abc', Config: { Image: 'imlouiskhenghao/foundry:2.36.0', Labels: {} }, State: { Running: false }, HostConfig: { RestartPolicy: { Name: 'no' } }, Mounts: [{ Type: 'volume', Name: 'engine-data', Source: '/v', Destination: '/app/data' }] }]));
        if (argv[0] === 'docker' && argv[1] === 'run') return ok(JSON.stringify({ '/app/data': { goals: 7, events: 70, last: null, moved: true } }) + '\n');
        return null;
      },
    });
    const [docker] = (await findEarlierInstalls({ probe })).installs;
    expect(docker).toMatchObject({ id: 'docker:foundry', goals: 0 });
    expect(docker!.folders[0]).toMatchObject({ path: '/app/data', moved: true });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
