import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeConfigEnv } from '../config.ts';
import { ClaudeAuth, claudeAuthStatus } from './claude-auth.ts';

/**
 * A stand-in for the CLI on a machine without a browser: it prints the URL, then asks for the code
 * on stdin **without a trailing newline** — exactly how the real one behaves in a container.
 */
function fakeClaude(dir: string, opts: { prompt?: boolean } = {}): string {
  const state = join(dir, 'logged-in');
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/bin/sh
if [ "$2" = "status" ]; then
  if [ -f "${state}" ]; then echo '{"loggedIn":true,"authMethod":"claudeai"}'; else echo '{"loggedIn":false}'; fi
  exit 0
fi
if [ "$2" = "login" ]; then
  echo "Opening browser to sign in…"
  echo "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true"
  ${opts.prompt === false ? 'touch "' + state + '"; echo done; exit 0' : 'printf "Paste code here if prompted > "\n  read code\n  [ -n "$code" ] && touch "' + state + '"\n  echo "Logged in"\n  exit 0'}
fi
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const settle = async (pred: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await Bun.sleep(20);
  }
};

for (const provider of ['claude', 'codex'] as const) test(`${provider} logout invalidates a pending account poll without returning stale identity`, async () => {
  let release!: () => void;
  const older = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const auth = new ClaudeAuth({ provider, claudeBin:'fixture', run:async args => {
    if (args.includes('logout')) return {code:0,stdout:'',stderr:''};
    const loggedIn = ++reads === 1;
    if (loggedIn) await older;
    return {code:loggedIn ? 0 : 1,stdout:provider === 'codex' ? (loggedIn ? 'Logged in using ChatGPT' : 'Not logged in') : JSON.stringify({loggedIn,email:loggedIn ? 'old@example.test' : null}),stderr:''};
  } });
  const poll = auth.status(true);
  const duplicate = auth.status(true);
  expect(reads).toBe(1);
  expect((await auth.logout()).loggedIn).toBe(false);
  release();
  for (const status of await Promise.all([poll,duplicate,auth.status()])) {
    expect(status.loggedIn).toBe(false);
    expect(status.email).toBeNull();
  }
  expect(reads).toBe(2);
});

describe('in-app Claude sign-in', () => {
  test('headless machine: the CLI asks for a code, the UI can post it, the login completes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    const auth = new ClaudeAuth({ claudeBin: fakeClaude(dir) });
    const s = auth.startLogin();
    expect(s.done).toBe(false);
    // the prompt has no newline: it must still be detected
    await settle(() => auth.loginSession()!.needsCode);
    const waiting = auth.loginSession()!;
    expect(waiting.url).toContain('claude.com/cai/oauth/authorize');
    expect(waiting.lines.join(' ')).toContain('Paste code here');
    auth.submitCode('  my-code-123  ');
    expect(auth.loginSession()!.needsCode).toBe(false);
    await settle(() => auth.loginSession()!.done, 8000);
    const done = auth.loginSession()!;
    expect(done.ok).toBe(true);
    expect(done.error).toBeNull();
    expect(done.lines).toContain('(code submitted)');
    expect((await auth.status(true)).loggedIn).toBe(true);
  });

  test('a wrong code is not the end: the CLI asks again and the UI can retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    const state = join(dir, 'logged-in');
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      `#!/bin/sh
if [ "$2" = "status" ]; then
  if [ -f "${state}" ]; then echo '{"loggedIn":true}'; else echo '{"loggedIn":false}'; fi
  exit 0
fi
echo "If the browser didn't open, visit: https://claude.com/x"
printf "Paste code here if prompted > "
read a
echo "Invalid code. Please make sure the full code was copied."
printf "Paste code here if prompted > "
read b
touch "${state}"
echo "Logged in"
`,
    );
    chmodSync(bin, 0o755);
    const auth = new ClaudeAuth({ claudeBin: bin });
    auth.startLogin({});
    await settle(() => auth.loginSession()!.needsCode);
    auth.submitCode('wrong');
    // the second prompt (again without a newline) must be noticed, or the user is stuck
    await settle(() => auth.loginSession()!.needsCode, 8000);
    expect(auth.loginSession()!.lines.join(' ')).toContain('Invalid code');
    auth.submitCode('right');
    await settle(() => auth.loginSession()!.done, 8000);
    expect(auth.loginSession()!.ok).toBe(true);
  });

  test('a CLI that rejects the code and then goes quiet still lets the user try again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      `#!/bin/sh
if [ "$2" = "status" ]; then echo '{"loggedIn":false}'; exit 0; fi
echo "visit: https://claude.com/x"
printf "Paste code here if prompted > "
read a
echo "Invalid code. Please make sure the full code was copied."
sleep 30
`,
    );
    chmodSync(bin, 0o755);
    const auth = new ClaudeAuth({ claudeBin: bin, timeoutMs: 25_000 });
    auth.startLogin({});
    await settle(() => auth.loginSession()!.needsCode);
    auth.submitCode('wrong');
    // no second prompt is ever printed, but the rejection alone must re-open the field
    await settle(() => auth.loginSession()!.needsCode, 8000);
    expect(auth.loginSession()!.lines.join(' ')).toContain('Invalid code');
    expect(() => auth.submitCode('another')).not.toThrow();
    auth.cancelLogin();
  });

  test('a code is refused when nothing is waiting for one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    const auth = new ClaudeAuth({ claudeBin: fakeClaude(dir, { prompt: false }) });
    expect(() => auth.submitCode('x')).toThrow(/no sign-in is in progress/);
    auth.startLogin({});
    await settle(() => auth.loginSession()!.done, 8000);
    expect(auth.loginSession()!.ok).toBe(true);
    expect(auth.loginSession()!.needsCode).toBe(false); // browser flow: never asked
    expect(() => auth.submitCode('x')).toThrow(/no sign-in is in progress/);
  });
});

describe('the Claude home the CLI is pointed at', () => {
  test('the default ~/.claude is never passed as CLAUDE_CONFIG_DIR: the CLI would look for its sign-in elsewhere', () => {
    expect(claudeConfigEnv(join(homedir(), '.claude'))).toEqual({});
    expect(claudeConfigEnv(`${join(homedir(), '.claude')}/`)).toEqual({});
    expect(claudeConfigEnv(null)).toEqual({});
    expect(claudeConfigEnv('/srv/claude-home')).toEqual({ CLAUDE_CONFIG_DIR: '/srv/claude-home' });
  });
  test('the sign-in check runs without CLAUDE_CONFIG_DIR for the default home, with it for a custom one', async () => {
    const seen: (string | undefined)[] = [];
    const run = (async (_cmd: string[], _cwd: string, opts?: { env?: Record<string, string> }) => {
      seen.push(opts?.env?.CLAUDE_CONFIG_DIR);
      return { code: 0, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: '' };
    }) as never;
    expect((await claudeAuthStatus('claude', run, join(homedir(), '.claude'))).loggedIn).toBe(true);
    await claudeAuthStatus('claude', run, '/srv/claude-home');
    expect(seen).toEqual([undefined, '/srv/claude-home']);
  });
});

test('Codex device sign-in: the one-time code and the page are picked out of what the CLI prints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-codex-device-'));
  const bin = join(dir, 'codex');
  // what `codex login --device-auth` prints (colours stripped), then it waits for the approval
  writeFileSync(bin, `#!/bin/sh
echo "Follow these steps to sign in with ChatGPT using device code authorization:"
echo ""
echo "1. Open this link in your browser and sign in to your account"
echo "   https://auth.openai.com/codex/device"
echo ""
echo "2. Enter this one-time code (expires in 15 minutes)"
echo "   AB12-CD34E"
sleep 0.3
echo "Successfully logged in"
`);
  chmodSync(bin, 0o755);
  let approved = false;
  const auth = new ClaudeAuth({ provider: 'codex', claudeBin: bin, run: async () => ({ code: approved ? 0 : 1, stdout: approved ? 'Logged in using ChatGPT' : 'Not logged in', stderr: '' }) });
  const s = await auth.startLogin({});
  await settle(() => !!s.deviceCode);
  expect([s.deviceCode, s.url, s.needsCode]).toEqual(['AB12-CD34E', 'https://auth.openai.com/codex/device', false]);
  approved = true;
  await settle(() => s.done);
  expect(s.ok).toBe(true);
});
