/** FIFO counting semaphore. */
export class Semaphore {
  private queue: (() => void)[] = [];
  private inUse = 0;

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

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.inUse++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.inUse--;
          this.drain();
        });
      };
      if (this.inUse < this.limit) grant();
      else this.queue.push(grant);
    });
  }

  private drain(): void {
    while (this.inUse < this.limit && this.queue.length) this.queue.shift()!();
  }
}
