import { exec } from '../git/git.ts';
import type { MinimaxModelQuota, MinimaxQuota } from './types.ts';

/** under this share of a window left, the header warns */
export const LOW_PERCENT = 10;
/** under this pay-as-you-go balance (the account's currency), the header warns */
export const LOW_BALANCE = 1;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Percent left, read the way mmx reads it: the API's percent when present, else the count, which the Token Plan
 * reports as what is left (not what was used).
 */
function remaining(count: unknown, total: unknown, percent: unknown): number | null {
  const p = num(percent);
  if (p !== null) return p;
  const c = num(count);
  const t = num(total);
  return c !== null && t !== null && t > 0 ? Math.round((c / t) * 1000) / 10 : null;
}

/** `mmx quota show --output json`: a Token Plan's model_remains, or a pay-as-you-go account balance. */
export function parseMinimaxQuota(json: unknown, now = new Date()): MinimaxQuota {
  const checkedAt = now.toISOString();
  const o = (json ?? {}) as Record<string, any>;
  if (o.error) return { state: 'error', message: String(o.error.message ?? o.error), checkedAt };
  if (Array.isArray(o.model_remains)) {
    const models: MinimaxModelQuota[] = o.model_remains
      // a model outside the plan has no totals and a "not in plan" status (3): nothing to report
      .filter((m: any) => !(m.current_interval_total_count === 0 && m.current_weekly_total_count === 0 && m.current_interval_status === 3))
      .map((m: any) => {
        const ms = num(m.remains_time);
        return {
          name: String(m.model_name ?? 'model'),
          remainingPercent: remaining(m.current_interval_usage_count, m.current_interval_total_count, m.current_interval_remaining_percent),
          weeklyRemainingPercent: remaining(m.current_weekly_usage_count, m.current_weekly_total_count, m.current_weekly_remaining_percent),
          resetsAt: ms !== null && ms > 0 ? new Date(now.getTime() + ms).toISOString() : null,
        };
      });
    const low = models.some((m) => [m.remainingPercent, m.weeklyRemainingPercent].some((p) => p !== null && p < LOW_PERCENT));
    return { state: 'plan', models, low, checkedAt };
  }
  const available = num(o.available_amount);
  if (available !== null) return { state: 'balance', available, low: available < LOW_BALANCE, checkedAt };
  return { state: 'error', message: 'mmx returned no quota or balance', checkedAt };
}

/** Run `mmx quota show` with the credentials sessions get. `signedIn` = Foundry has a key, or the user ran `mmx auth login`. */
export async function fetchMinimaxQuota(o: { bin: string | null; signedIn: boolean; env: Record<string, string>; cwd: string }): Promise<MinimaxQuota> {
  const checkedAt = new Date().toISOString();
  if (!o.bin) return { state: 'unavailable', reason: 'no-cli', checkedAt };
  if (!o.signedIn) return { state: 'unavailable', reason: 'no-key', checkedAt };
  const r = await exec([o.bin, 'quota', 'show', '--output', 'json', '--non-interactive', '--quiet', '--no-color'], o.cwd, { env: o.env, timeoutMs: 20_000 });
  // mmx may print progress ("Detecting region... failed") before its JSON
  const out = `${r.stdout}\n${r.stderr}`;
  try {
    return parseMinimaxQuota(JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)));
  } catch {
    return { state: 'error', message: (r.stderr || r.stdout).trim().slice(0, 300) || `mmx exited with ${r.code}`, checkedAt };
  }
}
