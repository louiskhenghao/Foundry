import { codexProcess, type CodexProcessOptions } from '../mcp/codex-process.ts';
import { codexVersionFromUserAgent } from '../codex-version.ts';

const READ_METHODS = new Set(['thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list']);

/** A short-lived connection restricted to metadata/history reads. Never resumes or starts a thread. */
export class CodexHistoryClient {
  private processes = new Set<ReturnType<typeof codexProcess>>();
  private stopped = false;
  constructor(private options: CodexProcessOptions) {}
  stop(): void { this.stopped = true; for (const process of this.processes) process.kill(); }

  async read<T>(work: (request: (method: string, params: Record<string, unknown>) => Promise<any>) => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error('External Codex session monitoring has stopped');
    let buffer = '';
    let nextId = 0;
    let failure: Error | null = null;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    const fail = (error: Error) => { failure ??= error; for (const value of pending.values()) value.reject(failure); pending.clear(); };
    const process = codexProcess({ ...this.options, timeoutMs: this.options.timeoutMs ?? 15_000 }, ['app-server', '--listen', 'stdio://'], (text, stream) => {
      if (stream !== 'stdout') return;
      buffer += text;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { fail(new Error('Codex history returned invalid JSON')); continue; }
        if (!message || typeof message !== 'object') { fail(new Error('Codex history returned an invalid response')); continue; }
        const promise = pending.get(message.id);
        if (!promise) continue;
        pending.delete(message.id);
        if (message.error) promise.reject(new Error('The native Codex CLI could not read this history; a newer CLI or the original desktop app may be needed'));
        else promise.resolve(message.result);
      }
    });
    this.processes.add(process);
    void process.result.then((result) => fail(new Error(`Codex history ${result.failure ?? 'connection closed before responding'}`)));
    const request = (method: string, params: Record<string, unknown>) => {
      if (failure) return Promise.reject(failure);
      return new Promise<any>((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); process.write(`${JSON.stringify({ id, method, params })}\n`); });
    };
    try {
      const init = await request('initialize', { clientInfo: { name: 'foundry_session_monitor', version: '1' }, capabilities: { experimentalApi: true } });
      const version = codexVersionFromUserAgent(init?.userAgent, 'foundry_session_monitor')?.split('.').map(Number);
      if (!version || (version[0] === 0 && version[1]! < 158)) throw new Error('Read-only external session monitoring requires Codex CLI 0.158 or newer with a recognizable version handshake');
      process.write('{"method":"initialized"}\n');
      return await work((method, params) => {
        if (!READ_METHODS.has(method)) return Promise.reject(new Error('External session monitoring only permits history reads'));
        return request(method, params);
      });
    } finally { process.kill(); await process.result; this.processes.delete(process); }
  }
}
