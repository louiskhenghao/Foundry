import { describe, expect, test } from 'bun:test';
import { NotificationSettings } from '@foundry/core';
import { NotificationDispatcher } from './dispatcher.ts';
import { Tailnet } from './tailnet.ts';

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
