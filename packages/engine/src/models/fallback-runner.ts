/**
 * A ClaudeRunner that survives model churn: when a session fails before producing anything because its
 * model is unavailable (deprecated alias, retired id, typo), the same spec is re-run with the next model of
 * the fallback list. Every run also feeds the model registry (requested name → resolved id, ok/fail).
 *
 * Consumers see one event stream and one result; the swap happens underneath. Every engine call site
 * iterates `events` before awaiting `result` (a safety drain covers the rare case where none does).
 */
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import type { ModelRegistry } from './registry.ts';

export interface FallbackRunnerOptions {
  fallbacks: (spec: RunSpec) => string[];
  registry?: ModelRegistry;
  /** called once per fallback, before the replacement session starts */
  onFallback?: (info: { spec: RunSpec; from: string; to: string; reason: string }) => void;
  log?: (m: string) => void;
}

/** Usage fields are numeric counters. Unknown deep/cyclic shapes are unsafe to replay. */
function hasUsage(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return value !== 0;
  if (!value || typeof value !== 'object') return false;
  if (depth > 8) return true;
  return Object.values(value).some((entry) => hasUsage(entry, depth + 1));
}

/** "nothing happened yet": safe to throw the session away and try another model */
export const isModelUnavailable = (r: RunResult, productiveEvents = false): boolean => {
  if (r.failureClass !== 'model_unavailable' || r.numTurns !== 0 || r.costUsd !== 0) return false;
  if (r.costStatus !== 'unavailable') return true;
  // Codex cannot report dollar cost, and a failed turn can contain completed tools despite numTurns=0.
  return !productiveEvents && !r.finalText?.trim() && r.structuredOutput == null
    && !Object.values(r.toolsUsed).some((count) => count > 0) && r.skillsUsed.length === 0 && r.permissionDenials.length === 0
    && !hasUsage(r.usage) && !hasUsage(r.modelUsage);
};

function productive(event: RunnerEvent): boolean {
  if (event.kind === 'text' || event.kind === 'thinking') return !!event.text.trim();
  if (event.kind === 'tool_use' || event.kind === 'tool_result' || event.kind === 'progress') return true;
  // Future native item kinds may not yet have a normalized event (for example a collaboration tool).
  if (event.kind === 'unknown' && event.raw && typeof event.raw === 'object') {
    const raw = event.raw as { type?: string; item?: { type?: string } };
    return /^item\./.test(raw.type ?? '') && raw.item?.type !== 'error';
  }
  return false;
}

export class ModelFallbackRunner implements ClaudeRunner {
  private running = new Set<(reason: string) => void>();
  constructor(
    private inner: ClaudeRunner,
    private opts: FallbackRunnerOptions,
  ) {}
  active(): number {
    return this.inner.active();
  }
  setMaxConcurrent(n: number): void {
    this.inner.setMaxConcurrent?.(n);
  }
  killAll(): number {
    const count = this.running.size;
    for (const kill of this.running) kill('shutdown');
    return Math.max(count, (this.inner as { killAll?: () => number }).killAll?.() ?? 0);
  }

  async run(spec: RunSpec): Promise<RunHandle> {
    const { registry } = this.opts;
    let current: RunHandle;
    let killed: string | null = null;
    const kill = (reason: string) => { killed ??= reason; current?.kill(reason); };
    this.running.add(kill);
    try { current = await this.inner.run(spec); }
    catch (error) { this.running.delete(kill); throw error; }
    if (killed !== null) current.kill(killed);
    // A buggy adapter may reject before its events finish. Observe it now, then handle it in the stream.
    void current.result.catch(() => {});
    let currentSpec = spec;
    let lastResult: RunResult | null = null;
    let replacing = false;
    const tried = new Set<string>(spec.model ? [spec.model] : []);
    let settle!: (r: RunResult) => void;
    const result = new Promise<RunResult>((res) => (settle = res));
    const next = (from: string) => this.opts.fallbacks(currentSpec).find((m) => m && m !== from && !tried.has(m)) ?? null;
    const failedResult = (error: unknown): RunResult => ({
      sessionId: null,
      costUsd: 0, numTurns: 0, durationMs: 0, usage: null, modelUsage: null, permissionDenials: [],
      finalText: null, structuredOutput: null, exitCode: null, pid: current.pid, rateLimit: null,
      skillsUsed: [], toolsUsed: {}, ...(lastResult ?? {}),
      subtype: replacing ? 'spawn_error' : 'error_during_execution', isError: true,
      errorMessage: error instanceof Error ? error.message : String(error), failureClass: 'other',
    });

    const gen = (async function* (self: ModelFallbackRunner): AsyncGenerator<RunnerEvent> {
      try {
        for (;;) {
          let productiveEvents = false;
          for await (const ev of current.events) {
            productiveEvents ||= productive(ev);
            if (ev.kind === 'init' && currentSpec.model) registry?.noteResolved(currentSpec.model, ev.model);
            yield ev;
          }
          const r = await current.result;
          lastResult = r;
          if (currentSpec.model) registry?.noteResult(currentSpec.model, r);
          const to = killed === null && spec.meta?.tier !== 'probe' && isModelUnavailable(r, productiveEvents) && currentSpec.model ? next(currentSpec.model) : null;
          if (!to) return settle(r);
          tried.add(to);
          const reason = (r.errorMessage ?? 'model unavailable').slice(0, 200);
          self.opts.log?.(`[models] ${currentSpec.model} unavailable (${reason}); retrying with ${to}`);
          self.opts.onFallback?.({ spec: currentSpec, from: currentSpec.model!, to, reason });
          if (killed !== null) return settle(r);
          currentSpec = { ...currentSpec, model: to, meta: { ...currentSpec.meta, modelFallback: '1' } };
          replacing = true;
          current = await self.inner.run(currentSpec);
          replacing = false;
          void current.result.catch(() => {});
          if (killed !== null) current.kill(killed);
        }
      } catch (error) {
        // A failed stream must not leave an unobserved child running after the outer result settles.
        try { current.kill('runner_error'); } catch {}
        const failed = failedResult(error);
        settle(failed);
        yield { kind: 'result', result: failed };
      } finally {
        self.running.delete(kill);
      }
    })(this);

    let iterating = false;
    const events: AsyncIterable<RunnerEvent> = {
      [Symbol.asyncIterator]() {
        iterating = true;
        return gen;
      },
    };
    // nobody asked for the events → drain them ourselves so `result` still settles
    setTimeout(() => {
      if (!iterating) {
        iterating = true;
        void (async () => {
          for await (const _ of gen) {
            /* drain */
          }
        })().catch((error) => settle(failedResult(error)));
      }
    }, 0);
    return {
      get pid() {
        return current.pid;
      },
      events,
      kill,
      result,
    };
  }
}
