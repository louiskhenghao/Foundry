import { codexVersionFromUserAgent } from '../codex-version.ts';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export interface CodexDiscoveredModel {
  /** The callable model slug, which can differ from the catalog entry's id. */
  id: string;
  displayName: string | null;
  description: string | null;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
}

export interface CodexDiscoveryOptions {
  signal?: AbortSignal;
  /** One deadline for initialization and every catalog page. */
  timeoutMs?: number;
  includeHidden?: boolean;
  /** Bound catalog entries across all pages, including hidden or duplicate entries. */
  maxModels?: number;
}

type RpcMessage = Record<string, unknown>;
const object = (value: unknown): value is RpcMessage => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Read the native CLI's catalog without starting a thread or performing inference. A catalog entry
 * is not an account entitlement check: app-server can use its bundled or cached model catalog.
 * Authentication and configuration remain owned by the CLI; Foundry never reads their files.
 */
export async function discoverCodexModels(
  bin: string,
  home: string,
  opts: CodexDiscoveryOptions = {},
): Promise<{ models: CodexDiscoveredModel[]; cliVersion?: string }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxModels = opts.maxModels ?? 1_000;
  if (opts.signal?.aborted) throw new Error('Codex model discovery cancelled');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Codex model discovery requires a positive timeout');
  if (!Number.isSafeInteger(maxModels) || maxModels <= 0) throw new Error('Codex model discovery requires a positive model limit');
  const proc = spawn(bin, ['app-server', '--listen', 'stdio://'], {
    // Do not inherit a goal repository's configuration while discovering account-level choices.
    cwd: tmpdir(),
    env: { ...process.env, CODEX_HOME: home, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const reaped = new Promise<void>(resolve => { proc.once('exit', () => resolve()); proc.once('error', () => resolve()); });
  const pending = new Map<number, { method: string; resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 0;
  let failure: Error | null = null;
  let buffer = '';
  let stderr = '';
  let outputBytes = 0;
  const fail = (error: Error) => {
    failure ??= error;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  };
  const timeout = setTimeout(() => fail(new Error(`Codex model discovery timed out after ${timeoutMs} ms`)), timeoutMs);
  const cancel = () => fail(new Error('Codex model discovery cancelled'));
  opts.signal?.addEventListener('abort', cancel, { once: true });
  proc.on('error', (error) => fail(new Error(`Cannot start Codex model discovery: ${error.message}`)));
  proc.stdin.on('error', (error) => fail(new Error(`Cannot write to Codex app-server: ${error.message}`)));
  proc.stdout.on('error', (error) => fail(new Error(`Cannot read from Codex app-server: ${error.message}`)));
  proc.stderr.on('error', (error) => fail(new Error(`Cannot read Codex app-server diagnostics: ${error.message}`)));
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2_000); });
  proc.stdout.on('data', (chunk: string) => {
    if (failure) return;
    outputBytes += Buffer.byteLength(chunk);
    buffer += chunk;
    if (outputBytes > 8 * 1024 * 1024 || buffer.length > 2 * 1024 * 1024) {
      fail(new Error('Codex model discovery exceeded the response size limit'));
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: unknown;
      try { message = JSON.parse(line); }
      catch { fail(new Error('Codex app-server returned invalid JSON during model discovery')); return; }
      if (!object(message) || typeof message.id !== 'number') continue; // notifications
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (object(message.error)) {
        const code = typeof message.error.code === 'number' ? ` (${message.error.code})` : '';
        request.reject(new Error(`Codex ${request.method}${code}: ${string(message.error.message) ?? 'request failed'}`));
      } else if ('result' in message) request.resolve(message.result);
      else request.reject(new Error(`Codex ${request.method} returned an invalid RPC response`));
    }
  });
  proc.on('close', (code, signal) => fail(new Error(`Codex app-server exited before model discovery completed (${signal ?? code ?? 'unknown'}).${stderr.trim() ? ` ${stderr.trim()}` : ''}`)));
  const send = (message: RpcMessage) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method: string, params: RpcMessage): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { method, resolve, reject });
      send({ id, method, params });
    });
  };
  try {
    const init = await request('initialize', { clientInfo: { name: 'foundry_model_catalog', title: 'Foundry', version: '1' }, capabilities: {} });
    const userAgent = object(init) ? string(init.userAgent) : null;
    const cliVersion = codexVersionFromUserAgent(userAgent, 'foundry_model_catalog');
    send({ method: 'initialized' });
    const models = new Map<string, CodexDiscoveredModel>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let entries = 0;
    for (let page = 0; page < 100; page++) {
      const result = await request('model/list', { limit: 100, includeHidden: opts.includeHidden ?? false, ...(cursor ? { cursor } : {}) });
      if (!object(result) || !Array.isArray(result.data)) throw new Error('Codex model/list returned an invalid model catalog');
      entries += result.data.length;
      if (entries > maxModels) throw new Error(`Codex model discovery exceeded the ${maxModels} model limit`);
      for (const entry of result.data) {
        if (!object(entry)) throw new Error('Codex model/list returned an invalid model entry');
        if (entry.hidden === true && !opts.includeHidden) continue;
        const id = string(entry.model) ?? string(entry.id);
        if (!id) throw new Error('Codex model/list returned a model without an id');
        const efforts = Array.isArray(entry.supportedReasoningEfforts) ? entry.supportedReasoningEfforts : [];
        const reasoningEfforts = [...new Set(efforts.flatMap((effort) => {
          const value = object(effort) ? string(effort.reasoningEffort) : null;
          return value ? [value] : [];
        }))];
        models.set(id, {
          id,
          displayName: string(entry.displayName),
          description: string(entry.description),
          reasoningEfforts,
          defaultReasoningEffort: string(entry.defaultReasoningEffort),
          isDefault: entry.isDefault === true,
        });
      }
      if (result.nextCursor == null || result.nextCursor === '') return { models: [...models.values()], ...(cliVersion ? { cliVersion } : {}) };
      if (typeof result.nextCursor !== 'string') throw new Error('Codex model/list returned an invalid pagination cursor');
      cursor = result.nextCursor;
      if (cursors.has(cursor)) throw new Error('Codex model/list repeated a pagination cursor');
      cursors.add(cursor);
    }
    throw new Error('Codex model discovery exceeded the pagination limit');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', cancel);
    // The app-server can start MCP sidecars. Reap the entire owned group even if its parent exits first.
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
        const exited = () => { if (!alive()) finish(); };
        const force = setTimeout(() => { signal('SIGKILL'); finish(); }, 250);
        proc.once('exit', exited);
        signal('SIGTERM');
        if (!alive()) finish();
      });
      await reaped;
    }
    proc.stdin.destroy();
    proc.stdout.destroy();
    proc.stderr.destroy();
  }
}
