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
  fallbacks: () => string[];
  registry?: ModelRegistry;
  /** called once per fallback, before the replacement session starts */
  onFallback?: (info: { spec: RunSpec; from: string; to: string; reason: string }) => void;
  log?: (m: string) => void;
}

/** "nothing happened yet": safe to throw the session away and try another model */
export const isModelUnavailable = (r: RunResult) => r.failureClass === 'model_unavailable' && r.numTurns === 0 && r.costUsd === 0;

export class ModelFallbackRunner implements ClaudeRunner {
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
    return (this.inner as { killAll?: () => number }).killAll?.() ?? 0;
  }

  async run(spec: RunSpec): Promise<RunHandle> {
    const { registry } = this.opts;
    let current = await this.inner.run(spec);
    let currentSpec = spec;
    const tried = new Set<string>(spec.model ? [spec.model] : []);
    let settle!: (r: RunResult) => void;
    const result = new Promise<RunResult>((res) => (settle = res));
    const next = (from: string) => this.opts.fallbacks().find((m) => m && m !== from && !tried.has(m)) ?? null;

    const gen = (async function* (self: ModelFallbackRunner): AsyncGenerator<RunnerEvent> {
      for (;;) {
        for await (const ev of current.events) {
          if (ev.kind === 'init' && currentSpec.model) registry?.noteResolved(currentSpec.model, ev.model);
          yield ev;
        }
        const r = await current.result;
        if (currentSpec.model) registry?.noteResult(currentSpec.model, r);
        const to = isModelUnavailable(r) && currentSpec.model ? next(currentSpec.model) : null;
        if (!to) return settle(r);
        tried.add(to);
        const reason = (r.errorMessage ?? 'model unavailable').slice(0, 200);
        self.opts.log?.(`[models] ${currentSpec.model} unavailable (${reason}); retrying with ${to}`);
        self.opts.onFallback?.({ spec: currentSpec, from: currentSpec.model!, to, reason });
        currentSpec = { ...currentSpec, model: to };
        current = await self.inner.run(currentSpec);
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
        })();
      }
    }, 0);
    return {
      get pid() {
        return current.pid;
      },
      events,
      kill: (reason: string) => current.kill(reason),
      result,
    };
  }
}
