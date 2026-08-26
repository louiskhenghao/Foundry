import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAuth } from './claude-auth.ts';

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

describe('in-app Claude sign-in', () => {
  test('headless machine: the CLI asks for a code, the UI can post it, the login completes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    const auth = new ClaudeAuth({ claudeBin: fakeClaude(dir) });
    const s = auth.startLogin({ mode: 'claudeai' });
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
