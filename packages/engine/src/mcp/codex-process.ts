import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';

export interface CodexProcessOptions {
  codexBin?: string;
  codexHome: string;
  processHome?: string;
  timeoutMs?: number;
}

/** Native CLI boundary. Raw output stays internal because MCP config can contain credentials. */
export function codexProcess(options: CodexProcessOptions, args: string[], onOutput?: (text: string, stream: 'stdout' | 'stderr') => void) {
  const child = spawn(options.codexBin ?? Bun.which('codex') ?? 'codex', args, {
    cwd: tmpdir(),
    env: { ...process.env, HOME: options.processHome ?? homedir(), CODEX_HOME: options.codexHome, NO_COLOR: '1', FORCE_COLOR: '0', BROWSER: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let failure: string | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let afterGroupKill: (() => void) | null = null;
  let done = false;
  const signal = (value: NodeJS.Signals) => {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value); else child.kill(value); } catch {}
  };
  const kill = () => {
    if (done || killTimer) return;
    signal('SIGTERM');
    killTimer = setTimeout(() => {
      signal('SIGKILL');
      killTimer = null;
      afterGroupKill?.();
    }, 250);
  };
  const timer = setTimeout(() => { failure = 'timed out'; kill(); }, options.timeoutMs ?? 30_000);
  const result = new Promise<{ code: number | null; stdout: string; stderr: string; failure: string | null }>((resolve) => {
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const complete = () => resolve({ code, stdout, stderr, failure });
      // A parent can exit on SIGTERM while its stdio-detached MCP children keep running. Preserve
      // the group SIGKILL deadline and await it before reporting cleanup complete.
      if (killTimer && process.platform !== 'win32') afterGroupKill = complete;
      else { if (killTimer) clearTimeout(killTimer); complete(); }
    };
    child.on('error', () => { failure = 'could not start the configured Codex CLI'; finish(null); });
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => { failure = 'could not read native output'; kill(); });
    child.stderr.on('error', () => { failure = 'could not read native diagnostics'; kill(); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(text) > 4 * 1024 * 1024) { failure = 'response exceeded the size limit'; kill(); return; }
      stdout += text;
      onOutput?.(text, 'stdout');
    });
    child.stderr.on('data', (text: string) => { stderr = (stderr + text).slice(-64_000); onOutput?.(text, 'stderr'); });
    child.on('close', finish);
  });
  return { result, kill, write: (text: string) => child.stdin.write(text), end: () => child.stdin.end() };
}

/** A fresh app-server connection performs tool discovery, not model inference or tool execution. */
export async function codexMcpStatus(options: CodexProcessOptions): Promise<Record<string, unknown>[]> {
  let nextId = 0;
  let buffer = '';
  let failure: Error | null = null;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => { failure ??= error; for (const p of pending.values()) p.reject(failure); pending.clear(); };
  // stdout is reserved for JSON-RPC; stderr is collected privately by the process helper.
  const rpc = codexProcess(options, ['app-server', '--listen', 'stdio://'], (text, stream) => {
    if (stream !== 'stdout') return;
    buffer += text;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { fail(new Error('Codex MCP returned invalid JSON')); continue; }
      if (!message || typeof message !== 'object') { fail(new Error('Codex MCP returned an invalid response')); continue; }
      const p = pending.get(message.id);
      if (!p) continue;
      pending.delete(message.id);
      if (message.error) p.reject(new Error('Codex MCP status request failed; check the native CLI configuration'));
      else p.resolve(message.result);
    }
  });
  void rpc.result.then((result) => fail(new Error(`Codex MCP status ${result.failure ?? 'process exited before responding'}`)));
  const request = (method: string, params: unknown) => {
    if (failure) return Promise.reject(failure);
    return new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      rpc.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'foundry_mcp', version: '1' }, capabilities: {} });
    rpc.write('{"method":"initialized"}\n');
    const rows: Record<string, unknown>[] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const response = await request('mcpServerStatus/list', { limit: 100, detail: 'full', ...(cursor ? { cursor } : {}) });
      if (!response || !Array.isArray(response.data)) throw new Error('Codex MCP returned an invalid status list');
      rows.push(...response.data);
      if (rows.length > 1000) throw new Error('Codex MCP status exceeded the server limit');
      if (response.nextCursor == null) return rows;
      if (typeof response.nextCursor !== 'string' || cursors.has(response.nextCursor)) throw new Error('Codex MCP returned an invalid pagination cursor');
      const nextCursor: string = response.nextCursor;
      cursor = nextCursor;
      cursors.add(nextCursor);
    }
    throw new Error('Codex MCP status exceeded the page limit');
  } finally { rpc.kill(); await rpc.result; }
}
