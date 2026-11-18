import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../../..');
// the stop finds who listens with lsof, or ss on a Linux without it
const findsListeners = !!(Bun.which('lsof') || Bun.which('ss'));

const freePort = () => {
  const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
  const port = s.port!;
  s.stop(true);
  return port;
};

/** install.sh's functions in a home of their own, for a binary install whose service is a background process */
async function control(home: string, verb: string, port: number) {
  const p = Bun.spawn(['bash', '-c', `source "${home}/lib.sh"; MODE=binary SERVICE=process PORT=${port}; control ${verb}`], { env: { HOME: home, PATH: process.env.PATH ?? '' }, stdout: 'pipe', stderr: 'pipe' });
  const code = await p.exited;
  return { code, out: (await new Response(p.stdout).text()) + (await new Response(p.stderr).text()) };
}

test('foundry stop stops a Foundry this install did not start that answers on its port (a checkout run by hand)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-stop-'));
  writeFileSync(join(home, 'lib.sh'), readFileSync(join(REPO, 'install.sh'), 'utf8').replace(/\nmain "\$@"\s*$/, '\n'));
  // a stand-in for `bun --watch apps/cli/src/main.ts serve`: it answers /api/health and shuts down on SIGTERM
  const checkout = join(home, 'checkout', 'apps', 'cli', 'src');
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, 'main.ts'), `const s = Bun.serve({ port: Number(process.env.FOUNDRY_PORT), hostname: '127.0.0.1', fetch: (r) => new Response('{"ok":true}', { status: new URL(r.url).pathname === '/api/health' ? 200 : 404 }) });\nprocess.on('SIGTERM', () => { s.stop(true); process.exit(0); });\n`);
  const port = freePort();
  const dev = Bun.spawn(['bun', '--watch', join(checkout, 'main.ts'), 'serve'], { env: { ...process.env, FOUNDRY_PORT: String(port) }, stdout: 'ignore', stderr: 'ignore' });
  try {
    for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok, () => false)); i++) await Bun.sleep(100);
    const status = await control(home, 'status', port);
    expect(status.out).toContain(`another Foundry answers on port ${port}`);
    const stop = await control(home, 'stop', port);
    if (!findsListeners) return void expect(stop.code).toBe(1);
    expect(stop.out).toContain(`a Foundry this install did not start answered on port ${port} (pid ${dev.pid}`);
    expect(stop.out).toContain('Foundry stopped');
    expect(stop.code).toBe(0);
    expect(await dev.exited).toBe(0);
  } finally {
    dev.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test('foundry stop leaves what is not a Foundry alone and fails naming it; with nothing left it says stopped', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-stop-'));
  writeFileSync(join(home, 'lib.sh'), readFileSync(join(REPO, 'install.sh'), 'utf8').replace(/\nmain "\$@"\s*$/, '\n'));
  // something else answering /api/health on the port: this test's own process
  const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: (r) => new Response('ok', { status: new URL(r.url).pathname === '/api/health' ? 200 : 404 }) });
  try {
    const stop = await control(home, 'stop', other.port!);
    expect(stop.code).toBe(1);
    expect(stop.out).not.toContain('Foundry stopped');
    expect(stop.out).toContain(`something still answers on port ${other.port}`);
    if (findsListeners) expect(stop.out).toContain(`kill ${process.pid}`);
    expect(stop.out).not.toContain('✘ stopped');
    const quiet = await control(home, 'stop', freePort());
    expect(quiet.code).toBe(0);
    expect(quiet.out).toContain('Foundry stopped');
  } finally {
    other.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
