import { describe, expect, test } from 'bun:test';
import { McpLogin, loginCommand, type LoginSpawn } from './login.ts';

/** a fake `claude mcp login` in a terminal: prints `out`, then (when asked) waits for a typed line before exiting with `code` */
function fake(out: string, code = 0, waitForInput = false) {
  const calls: { argv: string[]; input: string[] } = { argv: [], input: [] };
  const spawn: LoginSpawn = (argv, onData) => {
    calls.argv = argv;
    let release: () => void = () => {};
    const typed = new Promise<void>((r) => (release = r));
    queueMicrotask(() => onData(out));
    return { write: (s) => (calls.input.push(s), release()), exited: (waitForInput ? typed : Promise.resolve()).then(() => code), kill: () => release() };
  };
  return { spawn, calls };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(5);
};
const login = (spawn: LoginSpawn, headless = false) => new McpLogin({ claudeBin: () => '/usr/bin/claude', headless: () => headless, spawn, log: () => {} });
/** what the real CLI prints in a terminal: the link as a terminal hyperlink, CRLF line ends, a prompt without a newline */
const LINK = 'https://clerk.context7.com/oauth/authorize?response_type=code&state=s1';
const OAUTH = `Starting authentication for "context7"…\r\nVisit this URL to authorize:\r\n  \x1b]8;;${LINK}\x07${LINK}\x1b]8;;\x07\r\n\r\nWaiting for authorization… (^C to cancel)\r\nOr paste the redirect URL here: `;

describe('McpLogin', () => {
  test('a claude.ai connector: its authorization link is the result', async () => {
    const f = fake('Visit this URL to authorize:\r\n  https://claude.ai/api/organizations/o/mcp/start-auth/mcpsrv_1?product_surface=x\r\n\r\nOnce authorized on claude.ai, the connector will be available.\r\n');
    const s = login(f.spawn).start('claude.ai Gmail', true);
    await until(() => s.done);
    expect(f.calls.argv).toEqual(['/usr/bin/claude', 'mcp', 'login', 'claude.ai Gmail', '--no-browser']);
    expect(s).toMatchObject({ ok: true, url: 'https://claude.ai/api/organizations/o/mcp/start-auth/mcpsrv_1?product_surface=x', error: null, command: 'claude mcp login "claude.ai Gmail"' });
  });
  test('an OAuth server: the link comes out of the terminal hyperlink, and the pasted address is typed with Enter', async () => {
    const f = fake(OAUTH, 0, true);
    const l = login(f.spawn);
    const s = l.start('context7', false);
    await until(() => s.needsCode);
    expect(f.calls.argv).toEqual(['/usr/bin/claude', 'mcp', 'login', 'context7']);
    expect(s.url).toBe(LINK);
    expect(s.lines.join('\n')).not.toMatch(/\x1b|\x07|\r/);
    l.submit('http://localhost:1234/callback?code=abc');
    await until(() => s.done);
    expect(f.calls.input).toEqual(['http://localhost:1234/callback?code=abc\r']);
    expect(s.ok).toBe(true);
  });
  test('without a browser (Docker) it asks for --no-browser', () => {
    const f = fake(OAUTH, 0, true);
    const l = login(f.spawn, true);
    l.start('context7', false);
    expect(f.calls.argv.at(-1)).toBe('--no-browser');
    l.cancel();
  });
  test('when the CLI still wants a real terminal, the error says what to run', async () => {
    const f = fake(`Starting authentication for "context7"…\r\nCouldn't complete authentication for "context7": stdin isn't a terminal, so authentication can't be completed here.\r\n`, 1);
    const s = login(f.spawn).start('context7', false);
    await until(() => s.done);
    expect(s).toMatchObject({ ok: false, error: 'this sign-in needs a terminal: run claude mcp login context7' });
  });
  test('any other failure also offers the command, and only one sign-in runs at a time', async () => {
    const f = fake('error: server does not support OAuth\r\n', 1);
    const s = login(f.spawn).start('docs', false);
    await until(() => s.done);
    expect(s.error).toBe('claude mcp login exited 1 — you can run claude mcp login docs in a terminal instead');
    const w = fake(OAUTH, 0, true);
    const l2 = login(w.spawn, true);
    l2.start('a', false);
    expect(() => l2.start('b', false)).toThrow(/still open/);
    l2.cancel();
  });
  test('the command quotes names with spaces', () => {
    expect(loginCommand('context7')).toBe('claude mcp login context7');
    expect(loginCommand('claude.ai Google Drive')).toBe('claude mcp login "claude.ai Google Drive"');
  });
});
