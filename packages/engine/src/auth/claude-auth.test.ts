import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAuth, claudeAuthStatus } from './claude-auth.ts';

const dir = mkdtempSync(join(tmpdir(), 'ai-engine-auth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fakeClaude(name: string, script: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${script}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe('claude auth', () => {
  test('status parses JSON and falls back to text', async () => {
    const bin = fakeClaude('claude-json', 'echo "{\\"loggedIn\\":true,\\"email\\":\\"a@b\\",\\"subscriptionType\\":\\"max\\"}"');
    expect(await claudeAuthStatus(bin)).toMatchObject({ loggedIn: true, email: 'a@b', subscriptionType: 'max' });
    const txt = fakeClaude('claude-txt', 'echo "Not logged in"');
    expect((await claudeAuthStatus(txt)).loggedIn).toBe(false);
    expect((await claudeAuthStatus(null)).error).toContain('not installed');
  });

  test('login session captures the URL, then refreshes status', async () => {
    const state = join(dir, 'state');
    const bin = fakeClaude(
      'claude-login',
      `case "$2" in
        status) if [ -f ${state} ]; then echo '{"loggedIn":true,"email":"x@y","subscriptionType":"pro"}'; else echo '{"loggedIn":false}'; fi;;
        login) echo "Opening browser to https://claude.ai/oauth/authorize?code=abc"; sleep 0.2; touch ${state}; echo "Logged in as x@y";;
        logout) rm -f ${state}; echo "Logged out";;
      esac`,
    );
    const auth = new ClaudeAuth({ claudeBin: bin });
    expect((await auth.status()).loggedIn).toBe(false);
    const s = auth.startLogin();
    expect(auth.startLogin()).toBe(s); // single in-flight session
    await new Promise<void>((r) => {
      const off = auth.onLoginUpdate((u) => {
        if (u.done) {
          off();
          r();
        }
      });
    });
    expect(s.url).toBe('https://claude.ai/oauth/authorize?code=abc');
    expect(s.ok).toBe(true);
    expect((await auth.status()).email).toBe('x@y');
    const after = await auth.logout();
    expect(after.loggedIn).toBe(false);
  });
});
