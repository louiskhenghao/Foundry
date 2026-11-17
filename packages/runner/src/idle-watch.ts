/**
 * A session's idle limit (ADR-0101): the session is stopped after `idleMs` with nothing on its stream — unless a tool
 * call is under way. A build, a test run, a page fetch or a sub-agent writes nothing to the stream while it runs; the
 * coding agent's own tool timeouts bound it, and the wall clock bounds everything. So the clock stops while a tool call
 * is open and starts again, from zero, when its result arrives. Silence while nothing runs is the coding agent gone
 * quiet, and that is what the limit is for.
 */
export class IdleWatch {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly open = new Set<string>();
  private stopped = false;

  constructor(
    private readonly idleMs: number,
    private readonly onIdle: () => void,
  ) {
    this.arm();
  }

  /** how many tool calls are under way */
  get openTools(): number {
    return this.open.size;
  }
  /** the clock is running: nothing is under way and the limit will fire without further output */
  get armed(): boolean {
    return this.timer !== null;
  }

  /** something came down the stream: the clock starts again — unless a tool call is open, when it is not running */
  touch(): void {
    if (!this.open.size) this.arm();
  }
  /** a tool call began: the clock stops until every open call has ended */
  toolStarted(id: string): void {
    this.open.add(id);
    this.clear();
  }
  /** a tool call ended: when it was the last one open, the clock starts again from zero */
  toolEnded(id: string): void {
    if (!this.open.delete(id)) return;
    if (!this.open.size) this.arm();
  }
  /** the session is over: nothing fires after this */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private arm(): void {
    if (this.stopped) return;
    this.clear();
    this.timer = setTimeout(this.onIdle, this.idleMs);
  }
  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
