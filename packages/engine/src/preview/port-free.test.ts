import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { portFree } from './manager.ts';

const hold = (port: number, host: string, ipv6Only = false) => new Promise<Server>((r) => { const s = createServer(); s.listen({ port, host, ipv6Only }, () => r(s)); });

describe('portFree', () => {
  test('a port nothing holds is free; one held on loopback is not', async () => {
    expect(await portFree(47391)).toBe(true);
    const s = await hold(47391, '127.0.0.1');
    expect(await portFree(47391)).toBe(false);
    s.close();
  });

  test('a port loopback leaves free but every interface does not is not free (tailscale serve holds ports this way)', async () => {
    // an IPv6-only listener on the wildcard: 127.0.0.1 still binds, `::` — where Next listens — fails with EADDRINUSE
    const s = await hold(47392, '::', true);
    expect(await portFree(47392)).toBe(false);
    s.close();
  });
});
