import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export interface CodexAccountReadOptions { timeoutMs?: number; signal?: AbortSignal }
export class CodexAccountReadError extends Error {
  constructor(message: string, readonly kind: 'unavailable' | 'protocol' | 'timeout' | 'cancelled' | 'auth') { super(message); }
}
type RpcObject = Record<string, unknown>;
export const rpcObject = (value: unknown): value is RpcObject => !!value && typeof value === 'object' && !Array.isArray(value);
type ReadMethod = 'account/read' | 'account/rateLimits/read';
type Reader = (method: ReadMethod, params: RpcObject) => Promise<unknown>;

/** A bounded, read-only native session. Raw stderr and RPC error messages never leave this boundary. */
export async function withCodexAccountRpc<T>(bin: string, home: string | undefined, options: CodexAccountReadOptions, read: (request: Reader) => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new CodexAccountReadError('Codex account reads require a positive timeout.', 'protocol');
  if (options.signal?.aborted) throw new CodexAccountReadError('Codex account read cancelled.', 'cancelled');
  const proc = spawn(bin, ['app-server', '--listen', 'stdio://'], {
    cwd: tmpdir(), env: { ...process.env, ...(home ? { CODEX_HOME: home } : {}), NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const pending = new Map<number, { method: string; resolve(value: unknown): void; reject(error: Error): void }>();
  let id = 0;
  let failure: Error | null = null;
  let buffer = '';
  let bytes = 0;
  let initialized = false;
  const fail = (error: Error) => {
    failure ??= error;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  const cancel = () => fail(new CodexAccountReadError('Codex account read cancelled.', 'cancelled'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => fail(new CodexAccountReadError(`Codex account read timed out after ${timeoutMs} ms.`, 'timeout')), timeoutMs);
  proc.on('error', () => fail(new CodexAccountReadError('Cannot start the Codex account reader.', 'unavailable')));
  proc.stdin.on('error', () => fail(new CodexAccountReadError('Cannot write to the Codex account reader.', 'protocol')));
  proc.stdout.on('error', () => fail(new CodexAccountReadError('Cannot read the Codex account response.', 'protocol')));
  proc.stderr.on('error', () => fail(new CodexAccountReadError('Cannot read Codex account diagnostics.', 'protocol')));
  proc.stderr.resume(); // Drain diagnostics without retaining possible credential fragments.
  const send = (message: RpcObject) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    if (failure) return;
    bytes += Buffer.byteLength(chunk);
    buffer += chunk;
    if (bytes > 2 * 1024 * 1024 || buffer.length > 1024 * 1024) return fail(new CodexAccountReadError('Codex account response exceeded the size limit.', 'protocol'));
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { return fail(new CodexAccountReadError('Codex account reader returned invalid JSON.', 'protocol')); }
      if (!rpcObject(message)) continue;
      // Never fulfill token-refresh, approval or other server requests during a read-only status poll.
      if (typeof message.method === 'string') {
        if (typeof message.id === 'string' || typeof message.id === 'number') send({ id: message.id, error: { code: -32601, message: 'Read-only account client' } });
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (rpcObject(message.error)) {
        const unavailable = message.error.code === -32601;
        request.reject(new CodexAccountReadError(`Codex ${request.method} ${unavailable ? 'is unavailable in this CLI' : 'failed'}.`, unavailable ? 'unavailable' : 'protocol'));
      } else if ('result' in message) request.resolve(message.result);
      else request.reject(new CodexAccountReadError(`Codex ${request.method} returned an invalid response.`, 'protocol'));
    }
  });
  proc.on('close', () => fail(new CodexAccountReadError('Codex account reader exited before responding.', initialized ? 'protocol' : 'unavailable')));
  const request = (method: string, params: RpcObject): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { method, resolve, reject });
      send({ id: requestId, method, params });
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'foundry_account_status', title: 'Foundry', version: '1' }, capabilities: {} });
    initialized = true;
    send({ method: 'initialized' });
    return await read(request);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    if (proc.pid) {
      const group = process.platform !== 'win32';
      const signal = (value: NodeJS.Signals) => {
        try { if (group) process.kill(-proc.pid!, value); else proc.kill(value); } catch {}
      };
      const alive = () => {
        if (!group) return proc.exitCode === null && proc.signalCode === null;
        try { process.kill(-proc.pid!, 0); return true; } catch { return false; }
      };
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(force); proc.off('exit', exited); resolve(); };
        // The parent's exit does not prove its sidecars stopped. Keep the forced group cleanup armed.
        const exited = () => { if (!alive()) finish(); };
        const force = setTimeout(() => { signal('SIGKILL'); finish(); }, 250);
        proc.once('exit', exited);
        signal('SIGTERM');
        if (!alive()) finish();
      });
    }
    proc.stdin.destroy();
    proc.stdout.destroy();
    proc.stderr.destroy();
  }
}
