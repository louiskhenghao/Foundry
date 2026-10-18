import { describe, expect, test } from 'bun:test';
import { NotificationSettings } from '@foundry/core';
import { NotificationDispatcher } from './dispatcher.ts';
import { cliArgv, Tailnet } from './tailnet.ts';

/** a scripted `tailscale`: status, serve status and serve calls, recorded */
function fake(opts: { running?: boolean; served?: Record<string, string> } = {}) {
  const calls: string[][] = [];
  const web: Record<string, { Handlers: Record<string, { Proxy: string }> }> = Object.fromEntries(Object.entries(opts.served ?? {}).map(([k, v]) => [k, { Handlers: { '/': { Proxy: v } } }]));
  const exec = (async (cmd: string[]) => {
    const args = cmd.slice(1);
    calls.push(args);
    if (args[0] === 'status') return { code: 0, stdout: JSON.stringify({ BackendState: opts.running === false ? 'Stopped' : 'Running', Self: { DNSName: 'mac.tail-1.ts.net.' } }), stderr: '' };
    if (args[0] === 'serve' && args[1] === 'status') return { code: 0, stdout: JSON.stringify({ Web: web }), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }) as never;
  return { calls, exec };
}
const tailnet = (f: ReturnType<typeof fake>, mode: 'auto' | 'off' = 'auto', host: string | null = null) => new Tailnet({ mode: () => mode, host: () => host, log: () => {}, exec: f.exec, bin: '/usr/bin/tailscale' });

describe('Tailnet', () => {
  test("the Mac app's binary is called through a shell, so it acts as the CLI under launchd; a plain tailscale is called as it is", async () => {
    const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
    expect(cliArgv(app, ['status', '--json'])).toEqual(['/bin/sh', '-c', 'exec "$0" "$@"', app, 'status', '--json']);
    expect(cliArgv('/usr/local/bin/tailscale', ['status', '--json'])).toEqual(['/usr/local/bin/tailscale', 'status', '--json']);
    const seen: string[][] = [];
    const t = new Tailnet({ mode: () => 'auto', host: () => null, log: () => {}, bin: app, exec: (async (cmd: string[]) => (seen.push(cmd), { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'mini.tail-1.ts.net.' } }), stderr: '' })) as never });
    expect(await t.host()).toBe('mini.tail-1.ts.net');
    expect(seen[0]!.slice(0, 4)).toEqual(['/bin/sh', '-c', 'exec "$0" "$@"', app]);
  });

  test.skipIf(process.platform !== 'darwin' || !require('node:fs').existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale'))('through the shell the real app binary answers as the CLI', async () => {
    const r = Bun.spawnSync(cliArgv('/Applications/Tailscale.app/Contents/MacOS/Tailscale', ['version']));
    expect(r.stdout.toString()).not.toContain('GUI failed to start');
  });

  test("a port already served is reused; another is served by Foundry and taken down again; the person's stays", async () => {
    const f = fake({ served: { 'mac.tail-1.ts.net:443': 'http://127.0.0.1:4111' } });
    const t = tailnet(f);
    expect(await t.host()).toBe('mac.tail-1.ts.net');
    expect(await t.expose(4111)).toBe('https://mac.tail-1.ts.net');
    expect(await t.expose(4200)).toBe('https://mac.tail-1.ts.net:4200');
    expect(f.calls).toContainEqual(['serve', '--bg', '--https=4200', 'http://127.0.0.1:4200']);
    await t.unexposeAll();
    expect(f.calls).toContainEqual(['serve', '--https=4200', 'off']);
    expect(f.calls.filter((c) => c.includes('off'))).toHaveLength(1);
  });

  test('the proxy points at the loopback address the server listens on: an IPv6-only server is served at [::1], a serve to the side where nothing listens is pointed right', async () => {
    const f = fake({ served: { 'mac.tail-1.ts.net:4300': 'http://127.0.0.1:4300', 'mac.tail-1.ts.net:4303': 'http://localhost:4303', 'mac.tail-1.ts.net:4304': 'http://127.0.0.1:4304' } });
    // 4300, 4301 and 4303 answer on ::1 only (Node ≥ 17 binds localhost there); 4304 answers on 127.0.0.1; 4302 on nothing yet
    const listens = async (host: string, port: number) => ([4300, 4301, 4303].includes(port) && host === '[::1]') || (port === 4304 && host === '127.0.0.1');
    const t = new Tailnet({ mode: () => 'auto', host: () => null, log: () => {}, exec: f.exec, bin: '/usr/bin/tailscale', listens });
    expect(await t.loopback(4301)).toBe('[::1]');
    expect(await t.loopback(4302)).toBe('127.0.0.1');
    // nothing listens yet: IPv4, as before
    expect(await t.expose(4302)).toBe('https://mac.tail-1.ts.net:4302');
    expect(f.calls).toContainEqual(['serve', '--bg', '--https=4302', 'http://127.0.0.1:4302']);
    // listens on ::1 only: served there
    expect(await t.expose(4301)).toBe('https://mac.tail-1.ts.net:4301');
    expect(f.calls).toContainEqual(['serve', '--bg', '--https=4301', 'http://[::1]:4301']);
    // served to 127.0.0.1 already, where nothing listens while ::1 answers: pointed right, and Foundry's from now on
    expect(await t.expose(4300)).toBe('https://mac.tail-1.ts.net:4300');
    expect(f.calls).toContainEqual(['serve', '--bg', '--https=4300', 'http://[::1]:4300']);
    // served to localhost (either address), or to the side that answers: left as it is
    expect(await t.expose(4303)).toBe('https://mac.tail-1.ts.net:4303');
    expect(await t.expose(4304)).toBe('https://mac.tail-1.ts.net:4304');
    expect(f.calls.filter((c) => c[0] === 'serve' && c[1] === '--bg').map((c) => c[2])).toEqual(['--https=4302', '--https=4301', '--https=4300']);
    await t.unexposeAll();
    expect(f.calls.filter((c) => c[2] === 'off').map((c) => c[1]).sort()).toEqual(['--https=4300', '--https=4301', '--https=4302']);
  });

  test('serves an earlier run left behind (a crash) are taken down at start; its own ones are recorded until removed', async () => {
    const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'foundry-tailnet-'));
    const stateFile = join(dir, 'served.json');
    writeFileSync(stateFile, '[4201, 4202]');
    const f = fake();
    const t = new Tailnet({ mode: () => 'auto', host: () => null, log: () => {}, exec: f.exec, bin: '/usr/bin/tailscale', stateFile });
    await t.cleanUp();
    expect(f.calls).toEqual([['serve', '--https=4201', 'off'], ['serve', '--https=4202', 'off']]);
    await t.expose(4300);
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual([4300]);
    await t.unexpose(4300);
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('off, not running, or no tailscale: no tailnet links; a name from Settings without the command gives plain http', async () => {
    expect(await tailnet(fake(), 'off').expose(4200)).toBeNull();
    expect(await tailnet(fake({ running: false })).expose(4200)).toBeNull();
    expect(await new Tailnet({ mode: () => 'auto', host: () => null, log: () => {}, bin: null }).expose(4200)).toBeNull();
    expect(await new Tailnet({ mode: () => 'auto', host: () => 'https://box.tail-2.ts.net/', log: () => {}, bin: null }).expose(4200)).toBe('http://box.tail-2.ts.net:4200');
  });

  test('messages link to the page here and on the tailnet, and to a milestone preview both ways', async () => {
    const t = tailnet(fake({ served: { 'mac.tail-1.ts.net:443': 'http://127.0.0.1:4111' } }));
    const d = new NotificationDispatcher({ tailnet: t, config: { port: 4111 } } as never);
    expect(await d.links(NotificationSettings.parse({}), '/goals/g1', 'http://localhost:4200')).toEqual([
      { label: 'Open in Foundry', url: 'http://localhost:4111/goals/g1' },
      { label: 'Open on your tailnet', url: 'https://mac.tail-1.ts.net/goals/g1' },
      { label: 'Open the preview', url: 'http://localhost:4200' },
      { label: 'Open the preview on your tailnet', url: 'https://mac.tail-1.ts.net:4200' },
    ]);
    // a link base URL that already is the tailnet address is not repeated
    expect(await d.links(NotificationSettings.parse({ baseUrl: 'https://mac.tail-1.ts.net' }), '/inbox')).toEqual([{ label: 'Open in Foundry', url: 'https://mac.tail-1.ts.net/inbox' }]);
  });
});
