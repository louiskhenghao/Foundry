import { exec } from '../git/git.ts';
import type { AgyQuota, AgyQuotaBucket } from './types.ts';

/**
 * The Antigravity account's quota from `agy -p /usage --output-format json`, a read-only command the CLI answers itself
 * without a model turn: `command.data.groups[]`, each with its `buckets[]` (`remaining_fraction`, `reset_time`).
 */
export function parseAgyUsage(text: string, now = new Date()): AgyQuota {
  const at = now.toISOString();
  let payload: any = null;
  try {
    payload = JSON.parse(text.trim().split('\n').find((l) => l.trim().startsWith('{')) ?? 'null');
  } catch {}
  if (!payload) return { state: 'unavailable', groups: [], checkedAt: at, error: 'agy returned no usage report' };
  if (payload.status && payload.status !== 'SUCCESS') return { state: 'unavailable', groups: [], checkedAt: at, error: String(payload.error ?? payload.status).slice(0, 200) };
  const groups = Array.isArray(payload.command?.data?.groups) ? payload.command.data.groups : [];
  return {
    state: groups.length ? 'available' : 'unavailable',
    checkedAt: at,
    error: groups.length ? null : 'the usage report lists no quota',
    groups: groups.map((g: any) => ({
      name: String(g.name ?? 'Models'),
      description: typeof g.description === 'string' ? g.description : null,
      buckets: (Array.isArray(g.buckets) ? g.buckets : []).map(
        (b: any): AgyQuotaBucket => ({
          id: String(b.id ?? b.name ?? ''),
          name: String(b.name ?? b.id ?? 'Limit'),
          window: typeof b.window === 'string' ? b.window : null,
          remainingFraction: typeof b.remaining_fraction === 'number' ? Math.max(0, Math.min(1, b.remaining_fraction)) : null,
          resetTime: typeof b.reset_time === 'string' ? b.reset_time : null,
        }),
      ),
    })),
  };
}

/** reads the quota when asked, keeps it a minute; never throws */
export class AgyQuotaReader {
  private last: AgyQuota | null = null;
  private pending: Promise<AgyQuota> | null = null;
  constructor(private opts: { bin: () => string | null; run?: typeof exec; maxAgeMs?: number }) {}
  current(): AgyQuota | null {
    return this.last;
  }
  read(force = false): Promise<AgyQuota> {
    if (!force && this.last && Date.now() - Date.parse(this.last.checkedAt) < (this.opts.maxAgeMs ?? 60_000)) return Promise.resolve(this.last);
    if (this.pending) return this.pending;
    const bin = this.opts.bin();
    const run = this.opts.run ?? exec;
    this.pending = (async (): Promise<AgyQuota> => {
      if (!bin) return { state: 'unavailable', groups: [], checkedAt: new Date().toISOString(), error: 'agy is not installed' };
      const r = await run([bin, '-p', '/usage', '--output-format', 'json', '--print-timeout', '1m'], process.cwd(), { timeoutMs: 60_000 }).catch((e) => ({ code: 1, stdout: '', stderr: String((e as Error).message ?? e) }));
      return r.code === 0 ? parseAgyUsage(r.stdout) : { state: 'unavailable', groups: [], checkedAt: new Date().toISOString(), error: (r.stderr || r.stdout || `agy exited with code ${r.code}`).trim().slice(0, 200) };
    })().then((q) => {
      this.last = q;
      return q;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
