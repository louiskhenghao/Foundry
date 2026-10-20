import type { RunLane } from './types.ts';

/** how many slots beyond the limit the interactive lane may use: one, so a person never waits for a worker to finish */
export const INTERACTIVE_EXTRA = 1;

/**
 * FIFO counting semaphore with two lanes. `work` runs within the limit. `interactive` — a session a person is waiting
 * for — may use one slot beyond it and goes before queued work, so a busy engine still answers the person; interactive
 * runs queue behind each other, and work never passes work.
 */
export class Semaphore {
  private queue: { lane: RunLane; grant: () => void }[] = [];
  private inUse = 0;
  private work = 0;

  constructor(private limit: number) {}

  get activeCount(): number {
    return this.inUse;
  }
  get waiting(): number {
    return this.queue.length;
  }
  setLimit(n: number): void {
    this.limit = n;
    this.drain();
  }

  /** a slot is free for this lane: work within the limit, interactive within the limit plus the extra slot */
  private fits(lane: RunLane): boolean {
    return this.inUse < this.limit + INTERACTIVE_EXTRA && (lane === 'interactive' || this.work < this.limit);
  }
  /** a run in this lane would start now: a slot is free for it and nothing queued goes before it */
  available(lane: RunLane = 'work'): boolean {
    return this.fits(lane) && !this.queue.some((q) => lane === 'work' || q.lane === 'interactive');
  }

  acquire(lane: RunLane = 'work'): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.inUse++;
        if (lane === 'work') this.work++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.inUse--;
          if (lane === 'work') this.work--;
          this.drain();
        });
      };
      if (this.available(lane)) grant();
      else this.queue.push({ lane, grant });
    });
  }

  private drain(): void {
    // the first queued run that fits: an interactive one may pass work waiting for a slot within the limit
    for (;;) {
      const i = this.queue.findIndex((q) => this.fits(q.lane));
      if (i < 0) return;
      this.queue.splice(i, 1)[0]!.grant();
    }
  }
}
