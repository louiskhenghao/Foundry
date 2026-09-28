import { describe, expect, test } from 'bun:test';
import { McpLogin, type LoginSpawn } from './login.ts';

/** a fake `claude mcp login`: prints `out`, then (when given) waits for a line on stdin before exiting with `code` */
function fake(out: string, code = 0, waitForInput = false) {
  const calls: { argv: string[]; input: string[] } = { argv: [], input: [] };
  const spawn: LoginSpawn = (argv) => {
    calls.argv = argv;
    let release: () => void = () => {};
    const gotInput = new Promise<void>((r) => (release = r));
    const enc = new TextEncoder();
    const stdout = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(enc.encode(out));
        if (waitForInput) await gotInput;
        c.close();
      },
    });
    const stderr = new ReadableStream<Uint8Array>({ start: (c) => c.close() });
    return { stdout, stderr, stdin: { write: (s: string) => (calls.input.push(s), release()) }, exited: (waitForInput ? gotInput : Promise.resolve()).then(() => code), kill: () => release() };
  };
  return { spawn, calls };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(5);
};
const login = (spawn: LoginSpawn, headless = false) => new McpLogin({ claudeBin: () => '/usr/bin/claude', headless: () => headless, spawn, log: () => {} });

describe('McpLogin', () => {
  test('a claude.ai connector: its authorization link is the result', async () => {
    const f = fake('Visit this URL to authorize:\n  https://claude.ai/api/organizations/o/mcp/start-auth/mcpsrv_1?product_surface=x\n\nOnce authorized on claude.ai, the connector will be available.\n');
    const l = login(f.spawn);
    const s = l.start('claude.ai Gmail', true);
    await until(() => s.done);
    expect(f.calls.argv).toEqual(['/usr/bin/claude', 'mcp', 'login', 'claude.ai Gmail', '--no-browser']);
    expect(s).toMatchObject({ ok: true, url: 'https://claude.ai/api/organizations/o/mcp/start-auth/mcpsrv_1?product_surface=x', error: null });
  });
  test('an HTTP server without a browser waits for the redirected URL, then finishes', async () => {
    const f = fake('Open https://auth.example.com/authorize?x=1\nPaste the redirect URL here: ', 0, true);
    const l = login(f.spawn, true);
    const s = l.start('linear', false);
    await until(() => s.needsCode);
    expect(f.calls.argv.at(-1)).toBe('--no-browser');
    expect(s.url).toBe('https://auth.example.com/authorize?x=1');
    l.submit('http://localhost:1234/callback?code=abc');
    await until(() => s.done);
    expect(f.calls.input).toEqual(['http://localhost:1234/callback?code=abc\n']);
    expect(s.ok).toBe(true);
  });
  test('on this machine an HTTP server opens the browser itself (no --no-browser)', () => {
    const f = fake('Opening browser…\n');
    login(f.spawn).start('linear', false);
    expect(f.calls.argv).toEqual(['/usr/bin/claude', 'mcp', 'login', 'linear']);
  });
  test('a failed sign-in says so, and only one runs at a time', async () => {
    const f = fake('error: server does not support OAuth\n', 1);
    const l = login(f.spawn);
    const s = l.start('docs', false);
    await until(() => s.done);
    expect(s).toMatchObject({ ok: false, error: 'claude mcp login exited 1' });
    const w = fake('Paste the redirect URL: ', 0, true);
    const l2 = login(w.spawn, true);
    l2.start('a', false);
    expect(() => l2.start('b', false)).toThrow(/still open/);
    l2.cancel();
  });
});
