import { describe, expect, test } from 'bun:test';
import type { GhClient } from './gh.ts';
import { GhLogin } from './gh-login.ts';

/** a gh that prints what `gh auth login --web` prints without a terminal, then waits for approval (or a stop) */
function fakeGh() {
  let approve: (ok: boolean) => void = () => {};
  let authenticated = false;
  let logins = 0;
  const gh = {
    available: async () => ({ installed: true, version: '2.0.0', authenticated, login: authenticated ? 'octo' : null }),
    login: (onLine: (line: string) => void, signal?: AbortSignal) => {
      logins++;
      onLine('! First copy your one-time code: AB12-CD34');
      onLine('Open this URL to continue in your web browser: https://github.com/login/device');
      return new Promise<{ ok: boolean; output: string }>((resolve) => {
        approve = (ok) => {
          authenticated = ok;
          resolve({ ok, output: ok ? '✓ Logged in as octo' : 'error: expired' });
        };
        signal?.addEventListener('abort', () => resolve({ ok: false, output: 'killed' }));
      });
    },
  } as unknown as GhClient;
  return { gh, approve: (ok: boolean) => approve(ok), logins: () => logins };
}

const settled = async (l: GhLogin) => {
  for (let i = 0; i < 50 && !l.current()?.done; i++) await Bun.sleep(5);
  return l.current()!;
};

describe('GitHub sign-in from a page', () => {
  test('shows the code and the address, and who signed in once GitHub is approved', async () => {
    const f = fakeGh();
    const lines: string[] = [];
    const login = new GhLogin(() => f.gh, (l) => lines.push(l));
    const s = login.start();
    expect([s.code, s.url, s.done]).toEqual(['AB12-CD34', 'https://github.com/login/device', false]);
    // a second start while it runs is the same sign-in, not another gh
    expect(login.start().id).toBe(s.id);
    expect(f.logins()).toBe(1);
    f.approve(true);
    expect(await settled(login)).toMatchObject({ done: true, ok: true, login: 'octo', error: null });
    expect(lines).toHaveLength(2);
  });

  test('a stop or a failure says so; a new start after it runs gh again', async () => {
    const f = fakeGh();
    const login = new GhLogin(() => f.gh);
    login.start();
    login.cancel();
    expect(await settled(login)).toMatchObject({ done: true, ok: false, error: 'stopped before GitHub was approved' });
    const again = login.start();
    expect(f.logins()).toBe(2);
    f.approve(false);
    expect(await settled(login)).toMatchObject({ id: again.id, done: true, ok: false, error: 'error: expired' });
  });
});
