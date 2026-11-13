import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, waitFor } from '../test-helpers.ts';
import { flyOrgSlugs, netlifyTokenIn } from './signin.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let fakes: string;
const engines: Engine[] = [];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-signin-'));
  fakes = mkdtempSync(join(tmpdir(), 'foundry-signin-cli-'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, fakes]) rmSync(p, { recursive: true, force: true });
});
/** a stand-in for flyctl and the Netlify CLI: the browser login prints its page and waits for an approval file in the home it was given */
function fakeCli(): string {
  const path = join(fakes, 'fake-cli');
  writeFileSync(
    path,
    `#!/bin/sh
cli="$1"; shift
printf '%s|%s|home=%s|ci=%s|token=%s|browser=%s\\n' "$cli" "$*" "$HOME" "\${CI+set}" "\${FLY_API_TOKEN:+set}" "$BROWSER" >> "${join(fakes, 'calls.log')}"
case "$cli" in
  fly)
    case "$*" in
      version) echo "fly v0.5.10 darwin/arm64" ;;
      "auth login --code"*) echo "approved with the code" ; mkdir -p "$HOME/.fly"; echo "access_token: sess" > "$HOME/.fly/config.yml" ;;
      "auth login")
        echo "Open this URL in a browser and approve the login:"; echo ""; echo "    https://fly.io/app/auth/cli/abc123def456"; echo ""; echo "Waiting for the approval..."
        n=0; while [ ! -f "${join(fakes, 'APPROVE')}" ] && [ ! -f "$HOME/.fly/config.yml" ]; do sleep 0.1; n=$((n+1)); [ $n -gt 300 ] && exit 2; done
        mkdir -p "$HOME/.fly"; echo "access_token: sess" > "$HOME/.fly/config.yml"; echo "successfully logged in as louis@example.com" ;;
      "auth whoami") [ -f "$HOME/.fly/config.yml" ] && echo "louis@example.com" || { echo "no access token" >&2; exit 1; } ;;
      "orgs list --json") if [ -f "${join(fakes, 'MANY_ORGS')}" ]; then echo '[{"Slug":"acme","Name":"Acme"},{"Slug":"beta","Name":"Beta"}]'; else echo '[{"ID":"o1","Name":"Louis","Slug":"personal","Type":"PERSONAL"},{"ID":"o2","Name":"Acme","Slug":"acme","Type":"SHARED"}]'; fi ;;
      "tokens create org"*) if [ -f "${join(fakes, 'NO_TOKEN')}" ]; then echo "Error: not allowed" >&2; exit 1; fi; echo '{"token":"FlyV1 fm2_SECRETORGTOKEN0123456789"}' ;;
    esac ;;
  netlify)
    case "$*" in
      "login --request"*) echo '{"ticket_id":"tkt-1","url":"https://app.netlify.com/authorize?response_type=ticket&ticket=tkt-1","check_command":"netlify login --check tkt-1"}' ;;
      "login --check tkt-1"*)
        if [ -f "${join(fakes, 'DENY')}" ]; then echo '{"status":"denied"}'; exit 0; fi
        if [ -f "${join(fakes, 'APPROVE')}" ]; then mkdir -p "$HOME/.netlify"; echo '{"userId":"u1","users":{"u1":{"auth":{"token":"nfp_SECRETPAT0123456789"},"email":"louis@example.com"}}}' > "$HOME/.netlify/config.json"; echo '{"status":"authorized","user":{"id":"u1","email":"louis@example.com","name":"Louis"}}'; else echo '{"status":"pending"}'; fi ;;
    esac ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}
const calls = (): string[] => (existsSync(join(fakes, 'calls.log')) ? readFileSync(join(fakes, 'calls.log'), 'utf8').trim().split('\n') : []);
function engine() {
  const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), new FakeRunner(() => {}));
  engines.push(e);
  const cli = fakeCli();
  e.deployCli = (p) => [cli, p];
  e.signInPollMs = 20;
  return e;
}

describe('signing in to a deploy place through its CLI (ADR-0097)', () => {
  test('Fly.io: the login page is shown while the CLI waits in a home of its own; the approval makes an org token that lands in Settings; the home goes', async () => {
    process.env.FOUNDRY_NO_BROWSER = '1';
    // the engine may run where CI is set (a test runner, a server): flyctl must not see it, nor an earlier token
    process.env.CI = '1';
    process.env.FLY_API_TOKEN = 'FlyV1 old';
    const e = engine();
    expect(e.signInStatus('fly')).toMatchObject({ status: 'idle', url: null });
    const started = e.signIn('fly');
    expect(started.status).toBe('waiting');
    await waitFor(() => e.signInStatus('fly').url !== null);
    const waiting = e.signInStatus('fly');
    expect(waiting).toMatchObject({ status: 'waiting', url: 'https://fly.io/app/auth/cli/abc123def456', code: true, detail: 'approve the sign-in in the browser' });
    expect(waiting.output).toContain('Waiting for the approval');
    // the CLI ran with a home under the data folder, not the person's
    const login = calls().find((l) => l.startsWith('fly|auth login|'))!;
    const home = login.split('home=')[1]!.split('|')[0]!;
    expect(home.startsWith(join(dataDir, 'tmp'))).toBe(true);
    expect(login).toMatch(/\|ci=\|token=\|browser=\S*false$/);
    delete process.env.CI;
    delete process.env.FLY_API_TOKEN;
    // a second click while it waits changes nothing
    expect(e.signIn('fly').status).toBe('waiting');
    writeFileSync(join(fakes, 'APPROVE'), '');
    await waitFor(() => e.signInStatus('fly').status !== 'waiting');
    const done = e.signInStatus('fly');
    expect(done).toMatchObject({ status: 'done', account: 'louis@example.com', output: '' });
    expect(done.detail).toContain('signed in as louis@example.com');
    expect(e.settings.values().delivery.flyToken).toBe('FlyV1 fm2_SECRETORGTOKEN0123456789');
    expect(calls().map((l) => l.split('|')[1])).toEqual(['auth login', 'auth whoami', 'orgs list --json', 'tokens create org --name Foundry (deploys) --expiry 87600h --json --org personal']);
    expect(e.settings.values().delivery.flyOrg).toBe('personal');
    expect(done.detail).toContain('for personal');
    expect(existsSync(home)).toBe(false);
    expect(JSON.stringify(e.settingsView())).not.toContain('SECRETORGTOKEN');
  }, 20_000);

  test('Fly.io: the code from the approval page finishes a login approved elsewhere; a token that cannot be made is said', async () => {
    process.env.FOUNDRY_NO_BROWSER = '1';
    const e = engine();
    e.updateSettings({ delivery: { flyOrg: 'acme' } });
    e.signIn('fly');
    await waitFor(() => e.signInStatus('fly').url !== null);
    await expect(e.signInCode('fly', '!!')).rejects.toThrow(/letters and digits/);
    const s = await e.signInCode('fly', 'ABCD-1234');
    expect(s.status).toBe('done');
    expect(calls().some((l) => l.includes('auth login --code ABCD-1234'))).toBe(true);
    expect(calls().at(-1)).toContain('tokens create org --name Foundry (deploys) --expiry 87600h --json --org acme');
    expect(e.settings.values().delivery.flyToken).toBe('FlyV1 fm2_SECRETORGTOKEN0123456789');
    // no token: failed in words, nothing saved
    const e2 = engine();
    e2.updateSettings({ delivery: { flyToken: null } });
    rmSync(join(fakes, 'calls.log'), { force: true });
    writeFileSync(join(fakes, 'NO_TOKEN'), '');
    writeFileSync(join(fakes, 'APPROVE'), '');
    e2.signIn('fly');
    await waitFor(() => e2.signInStatus('fly').status !== 'waiting');
    expect(e2.signInStatus('fly')).toMatchObject({ status: 'failed', detail: expect.stringContaining('no token could be made') });
    expect(e2.settings.values().delivery.flyToken).toBeNull();
    // several organizations and none personal, nothing in Settings: the person picks, in words
    const e3 = engine();
    e3.updateSettings({ delivery: { flyToken: null, flyOrg: null } });
    rmSync(join(fakes, 'NO_TOKEN'));
    writeFileSync(join(fakes, 'MANY_ORGS'), '');
    e3.signIn('fly');
    await waitFor(() => e3.signInStatus('fly').status !== 'waiting');
    expect(e3.signInStatus('fly').detail).toContain('several organizations (acme, beta): set Fly.io organization in Settings');
    expect(e3.settings.values().delivery.flyToken).toBeNull();
  }, 20_000);

  test('Netlify: a ticket, its page, the check until approved, the token the CLI stored read from its home; a denied ticket and a cancel end it', async () => {
    process.env.FOUNDRY_NO_BROWSER = '1';
    const e = engine();
    e.signIn('netlify');
    await waitFor(() => e.signInStatus('netlify').url !== null);
    expect(e.signInStatus('netlify')).toMatchObject({ status: 'waiting', url: 'https://app.netlify.com/authorize?response_type=ticket&ticket=tkt-1', code: false });
    await waitFor(() => calls().filter((l) => l.includes('login --check')).length >= 2);
    writeFileSync(join(fakes, 'APPROVE'), '');
    await waitFor(() => e.signInStatus('netlify').status !== 'waiting');
    expect(e.signInStatus('netlify')).toMatchObject({ status: 'done', account: 'louis@example.com' });
    expect(e.settings.values().delivery.netlifyToken).toBe('nfp_SECRETPAT0123456789');
    expect(readdirSync(join(dataDir, 'tmp')).filter((n) => n.startsWith('signin-'))).toEqual([]);
    // denied
    rmSync(join(fakes, 'APPROVE'));
    writeFileSync(join(fakes, 'DENY'), '');
    const e2 = engine();
    e2.signIn('netlify');
    await waitFor(() => e2.signInStatus('netlify').status !== 'waiting');
    expect(e2.signInStatus('netlify').detail).toContain('denied');
    // cancelled while waiting
    rmSync(join(fakes, 'DENY'));
    const e3 = engine();
    e3.updateSettings({ delivery: { netlifyToken: null } });
    e3.signIn('netlify');
    await waitFor(() => e3.signInStatus('netlify').url !== null);
    expect(e3.signInCancel('netlify').status).toBe('idle');
    expect(e3.settings.values().delivery.netlifyToken).toBeNull();
  }, 20_000);

  test('the Netlify token is found wherever its CLI put config.json under the home; flyctl’s presence and install are reported', async () => {
    expect(flyOrgSlugs('[{"Slug":"personal"},{"slug":"acme"},{"Name":"x"}]')).toEqual(['personal', 'acme']);
    expect(flyOrgSlugs('nope')).toEqual([]);
    const home = mkdtempSync(join(tmpdir(), 'foundry-nl-home-'));
    expect(netlifyTokenIn(home)).toBeNull();
    mkdirSync(join(home, 'Library/Preferences/netlify'), { recursive: true });
    writeFileSync(join(home, 'Library/Preferences/netlify/config.json'), JSON.stringify({ userId: 'u2', users: { u1: { auth: { token: 'old' } }, u2: { auth: { token: 'nfp_right' } } } }));
    expect(netlifyTokenIn(home)).toBe('nfp_right');
    rmSync(home, { recursive: true, force: true });
    const e = engine();
    expect(await e.flyctl()).toMatchObject({ tool: 'fly', installed: { version: 'fly v0.5.10 darwin/arm64' }, status: 'idle' });
    e.installFlyCommand = ['sh', '-c', 'echo "flyctl was installed successfully"'];
    expect(e.installFlyctl().status).toBe('installing');
    await waitFor(async () => (await e.flyctl()).status !== 'installing');
    expect(await e.flyctl()).toMatchObject({ status: 'done', detail: expect.stringContaining('installed fly v0.5.10') });
    const e2 = engine();
    e2.deployCli = () => ['/nonexistent/fly'];
    expect((await e2.flyctl()).installed).toBeNull();
    e2.installFlyCommand = ['sh', '-c', 'echo "curl: (6) Could not resolve host" >&2; exit 6'];
    e2.installFlyctl();
    await waitFor(async () => (await e2.flyctl()).status !== 'installing');
    expect(await e2.flyctl()).toMatchObject({ status: 'failed', detail: expect.stringContaining('exit 6') });
  }, 20_000);
});
