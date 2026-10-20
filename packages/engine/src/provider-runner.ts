import { Semaphore, type AgentRunner, type RunHandle, type RunLane, type RunSpec } from '@foundry/runner';

export type AgentProvider = 'claude' | 'codex';

/** One global concurrency budget; each goal resolves to its immutable backend. */
export class ProviderRunner implements AgentRunner {
  private slots: Semaphore;
  constructor(private runners: Record<AgentProvider, AgentRunner>, private select: (spec: RunSpec) => AgentProvider, limit: number) {
    this.slots = new Semaphore(limit);
  }
  active(): number { return this.slots.activeCount; }
  /** a run in this lane would wait for a slot now: the caller says so before starting it */
  wouldQueue(lane: RunLane = 'work'): boolean { return !this.slots.available(lane); }
  setMaxConcurrent(n: number): void {
    this.slots.setLimit(n);
    for (const runner of new Set(Object.values(this.runners))) runner.setMaxConcurrent?.(n);
  }
  killAll(): number {
    let killed = 0;
    for (const runner of new Set(Object.values(this.runners))) killed += (runner as AgentRunner & { killAll?: () => number }).killAll?.() ?? 0;
    return killed;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    const provider = this.select(spec);
    const release = await this.slots.acquire(spec.lane);
    try {
      const handle = await this.runners[provider].run(spec);
      const result = handle.result.finally(release);
      return { get pid() { return handle.pid; }, events: handle.events, kill: (reason) => handle.kill(reason), result };
    } catch (error) { release(); throw error; }
  }
}
