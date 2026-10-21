import { exec } from '../git/git.ts';
import type { ClaudeAuthStatus } from './claude-auth.ts';

/**
 * Whether the Antigravity CLI is signed in, read the only way its print mode offers: a read-only `/usage` command
 * answered without a model turn. A CLI without credentials ends such a run with an authentication error instead of
 * hanging. The payload's shape is the CLI's own; the account name is taken from the fields it is likely to carry.
 */
export async function agyAuthStatus(bin: string | null, run: typeof exec = exec): Promise<ClaudeAuthStatus> {
  const base: ClaudeAuthStatus = { provider: 'agy', loggedIn: false, authMethod: null, apiProvider: 'google', email: null, orgName: null, subscriptionType: null, checkedAt: new Date().toISOString(), error: null };
  if (!bin) return { ...base, error: 'agy not installed' };
  let r: { code: number; stdout: string; stderr: string };
  try {
    r = await run([bin, '-p', '/usage', '--output-format', 'json', '--print-timeout', '1m'], process.cwd(), { timeoutMs: 60_000, env: { ...process.env, AGY_CLI_HIDE_LOGO: '1', AGY_CLI_HIDE_ACCOUNT_INFO: '1' } });
  } catch (err) {
    return { ...base, error: String((err as Error).message ?? err).slice(0, 200) };
  }
  const text = (r.stdout || '').trim();
  let payload: any = null;
  try {
    payload = JSON.parse(text.split('\n').find((l) => l.startsWith('{')) ?? 'null');
  } catch {}
  const failure = String(payload?.error ?? r.stderr ?? '').trim();
  if (r.code !== 0 || (payload && payload.status && payload.status !== 'SUCCESS') || !payload) {
    const auth = /auth|sign.?in|log.?in|credential/i.test(failure);
    return { ...base, error: auth ? 'not signed in' : (failure || `agy exited with code ${r.code}`).slice(0, 200) };
  }
  const info = payload.structured_output ?? payload.data ?? payload.usage ?? payload;
  const pick = (...keys: string[]) => keys.map((k) => info?.[k] ?? payload?.[k]).find((v) => typeof v === 'string' && v) as string | undefined;
  return { ...base, loggedIn: true, authMethod: process.env.GEMINI_API_KEY ? 'api_key' : 'oauth', email: pick('email', 'account', 'user', 'userEmail') ?? null, subscriptionType: pick('plan', 'tier', 'subscription', 'planName') ?? null };
}
