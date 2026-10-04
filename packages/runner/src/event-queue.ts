import type { RunnerEvent } from './types.ts';

/** Async queue bridging push-style stdout parsing to an AsyncIterable. */
export class EventQueue implements AsyncIterable<RunnerEvent> {
  private items: RunnerEvent[] = [];
  private waiters: ((v: IteratorResult<RunnerEvent>) => void)[] = [];
  private closed = false;
  push(e: RunnerEvent) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: e, done: false });
    else this.items.push(e);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<RunnerEvent> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

