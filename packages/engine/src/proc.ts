/**
 * Commands that start other programs (a test runner that boots a dev server, a package manager, docker) hand their
 * pipes down to them. Killing only the leader on a timeout leaves the children holding stdout open, and reading it to
 * the end then waits forever — a task that sat in "observing" until the engine restarted. Every such command runs in
 * its own process group: a timeout kills the whole group, and once the leader exits its output is read for a short
 * grace and no longer.
 */

export interface GroupResult {
  code: number;
  stdout: string;
  stderr: string;
  /** killed because it ran past `timeoutMs` */
  timedOut: boolean;
}

export interface GroupOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  /** how long to keep reading after the leader exited (default 2 s) */
  graceMs?: number;
  /** kill what the leader left running in its group once it exits (a check's dev server); default false */
  killLeftovers?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

const GROUPS = process.platform !== 'win32';

// a group no longer gets the terminal's Ctrl-C with the engine, so the engine takes its live groups down when it exits
const live = new Set<{ pid: number; kill: (sig?: number | NodeJS.Signals) => void }>();
let exitHook = false;
function track(proc: { pid: number; kill: (sig?: number | NodeJS.Signals) => void }): () => void {
  if (!exitHook) {
    exitHook = true;
    process.once('exit', () => {
      for (const p of live) killGroup(p);
    });
  }
  live.add(proc);
  return () => live.delete(proc);
}

/** SIGKILL the process group led by `pid` (the process alone where groups do not exist); never throws */
export function killGroup(proc: { pid: number; kill: (sig?: number | NodeJS.Signals) => void }): void {
  try {
    if (GROUPS) process.kill(-proc.pid, 'SIGKILL');
    else proc.kill('SIGKILL');
  } catch {
    // already gone
  }
}

function reader(stream: ReadableStream<Uint8Array> | null | undefined, onChunk?: (chunk: string) => void) {
  let text = '';
  if (!stream) return { done: Promise.resolve(), cancel: () => {}, text: () => text };
  const r = stream.getReader();
  const dec = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        text += chunk;
        onChunk?.(chunk);
      }
      const rest = dec.decode();
      if (rest) {
        text += rest;
        onChunk?.(rest);
      }
    } catch {
      // cancelled
    }
  })();
  return { done, cancel: () => void r.cancel().catch(() => {}), text: () => text };
}

export async function runInGroup(argv: string[], opts: GroupOptions): Promise<GroupResult> {
  const proc = Bun.spawn(argv, { cwd: opts.cwd, env: opts.env as Record<string, string> | undefined, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: GROUPS });
  const untrack = track(proc);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(proc);
  }, opts.timeoutMs);
  const out = reader(proc.stdout, opts.onStdout);
  const err = reader(proc.stderr, opts.onStderr);
  const code = await proc.exited;
  clearTimeout(timer);
  if (opts.killLeftovers) killGroup(proc);
  untrack();
  // the leader is gone: whatever still holds the pipes gets a moment to flush, then reading stops
  let grace: ReturnType<typeof setTimeout> | undefined;
  const drained = await Promise.race([Promise.all([out.done, err.done]).then(() => true), new Promise<boolean>((r) => (grace = setTimeout(() => r(false), opts.graceMs ?? 2_000)))]);
  clearTimeout(grace);
  if (!drained) {
    out.cancel();
    err.cancel();
  }
  return { code, stdout: out.text(), stderr: err.text(), timedOut };
}
