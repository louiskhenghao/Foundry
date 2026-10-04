import { CodexAccountReadError } from '../auth/codex-app-server.ts';
import { readCodexUsage, type CodexUsageSnapshot } from './codex-usage.ts';
import type { CodexQuota } from './types.ts';

export function quotaView(native: CodexUsageSnapshot): CodexQuota {
  const named = Object.entries(native.rateLimitsByLimitId ?? {});
  const entries = named.length ? named : [[native.rateLimits.limitId ?? 'codex', native.rateLimits] as const];
  return {
    state: 'available', checkedAt: native.checkedAt, ordinaryUsageAllowed: native.ordinaryUsageAllowed,
    buckets: entries.map(([id, bucket]) => ({ id, label: bucket.limitName ?? bucket.normalModelSlug ?? id, primary: bucket.primary, secondary: bucket.secondary })),
  };
}

/** Coalesce status polls and discard cached account data immediately when credentials change. */
export class CodexQuotaReader {
  private cached: { at: number; value: CodexQuota } | null = null;
  private pending: Promise<CodexQuota> | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  constructor(private opts: { bin: () => string | null; home: string; read?: typeof readCodexUsage; now?: () => number }) {}
  current(): CodexQuota | undefined { return this.cached?.value; }
  invalidate(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    this.cached = null;
  }
  read(force = false): Promise<CodexQuota> {
    const now = this.opts.now?.() ?? Date.now();
    if (this.pending) return this.pending;
    if (!force && this.cached && now - this.cached.at < (this.cached.value.state === 'error' ? 15_000 : 60_000)) return Promise.resolve(this.cached.value);
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = (async (): Promise<CodexQuota> => {
      const bin = this.opts.bin();
      if (!bin) return { state: 'unavailable', checkedAt: new Date(now).toISOString(), message: 'Install the Codex CLI to read ChatGPT quota.' };
      try { return quotaView(await (this.opts.read ?? readCodexUsage)(bin, this.opts.home, { signal: controller.signal })); }
      catch (error) {
        return { state: error instanceof CodexAccountReadError && ['auth', 'unavailable'].includes(error.kind) ? 'unavailable' : 'error', checkedAt: new Date(now).toISOString(), message: error instanceof CodexAccountReadError ? error.message : 'Could not read ChatGPT quota from Codex.' };
      }
    })().then((value) => {
      if (generation !== this.generation) return { state: 'unavailable' as const, checkedAt: new Date(now).toISOString(), message: 'Account changed. Refresh to read the current quota.' };
      this.cached = { at: now, value };
      return value;
    }).finally(() => { if (generation === this.generation) { this.pending = null; this.controller = null; } });
    return this.pending;
  }
}
