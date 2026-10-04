import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { DoctorCheck } from '../skills/types.ts';
import { MCP_PREFIX, SERVER_NAME, type CustomServer } from './manager.ts';
import { codexMcpStatus, codexProcess, type CodexProcessOptions } from './codex-process.ts';
import { McpCatalog, type McpHealth, type McpLoginSession, type McpServerRow, type McpView } from './types.ts';

interface NativeServer {
  name: string;
  enabled?: boolean;
  auth_status?: string;
  transport: { type: string; command?: string; args?: string[]; url?: string };
}
type Result = { ok: boolean; error: string | null };
export interface CodexMcpManagerOptions extends CodexProcessOptions {
  catalogPath: string;
  allowed: () => string[];
  setAllowed: (prefixes: string[]) => void;
  log: (message: string) => void;
  loginTimeoutMs?: number;
}

/** Native Codex MCP configuration and OAuth; independent from the user's Claude configuration. */
export class CodexMcpManager {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: McpCatalog | null = null;
  readonly login: CodexMcpLogin;
  constructor(private options: CodexMcpManagerOptions) { this.login = new CodexMcpLogin(options); }

  catalog(): McpCatalog {
    this.cached ??= McpCatalog.parse(JSON.parse(readFileSync(this.options.catalogPath, 'utf8')));
    return this.cached;
  }

  async view(): Promise<McpView> {
    const entries = this.catalog().entries;
    const servers: McpServerRow[] = (await this.nativeServers()).map((server) => {
      const transport = server.transport.type === 'stdio' ? 'stdio' : server.transport.type === 'streamable_http' ? 'http' : null;
      let target: string | null = null;
      // Arguments, environment, headers and URL paths can contain keys; none belong in a settings response.
      if (transport === 'stdio' && server.transport.command) target = basename(server.transport.command);
      if (transport === 'http' && server.transport.url) {
        try { target = new URL(server.transport.url).origin; } catch {}
      }
      if (target && server.enabled === false) target += ' (disabled in Codex)';
      return { name: server.name, source: 'user', plugin: null, prefix: `mcp__${server.name}`, transport, target, allowed: this.options.allowed().includes(`mcp__${server.name}`), catalogId: entries.find((entry) => entry.name === server.name)?.id ?? null };
    });
    return { servers, catalog: entries.map((entry) => ({ entry, installed: servers.some((server) => server.name === entry.name) })) };
  }

  /** Opens a fresh native MCP connection and discovers tools. No inference or MCP tool calls. */
  async check(): Promise<McpHealth[]> {
    const configured = await this.nativeServers();
    const status = await codexMcpStatus({ ...this.options, timeoutMs: this.options.timeoutMs ?? 120_000 });
    return configured.map((server): McpHealth => {
      if (server.enabled === false) return { name: server.name, status: 'pending', detail: 'Disabled in the native Codex configuration' };
      const row = status.find((value) => value.name === server.name);
      if (!row) return { name: server.name, status: 'unknown', detail: 'The native CLI returned no connection status' };
      if (row.runtimeStatus === 'authenticationRequired' || row.authStatus === 'notLoggedIn') return { name: server.name, status: 'needs-auth', detail: 'Sign in to this MCP server' };
      if (row.toolsError || row.runtimeStatus === 'failed' || row.runtimeStatus === 'cancelled') return { name: server.name, status: 'failed', detail: 'Native MCP connection or tool discovery failed; check the server configuration' };
      if (row.runtimeStatus === 'connected' || row.serverInfo || row.serverCapabilities) return { name: server.name, status: 'connected', detail: 'Connected and discovered through the native Codex MCP client' };
      return { name: server.name, status: row.runtimeStatus === 'starting' ? 'pending' : 'unknown', detail: 'Connection readiness was not confirmed by the native CLI' };
    });
  }

  install(what: { catalogId: string } | { custom: CustomServer }, keys: Record<string, string>, say: (line: string) => void = () => {}, replace = false): Promise<Result> {
    return this.serial(async () => {
      const entry = 'catalogId' in what ? this.catalog().entries.find((value) => value.id === what.catalogId) : null;
      if ('catalogId' in what && !entry) return { ok: false, error: 'Unknown MCP catalog entry' };
      const name = entry?.name ?? ('custom' in what ? what.custom.name : '');
      if (!SERVER_NAME.test(name)) return { ok: false, error: 'Invalid MCP server name' };
      const config: Record<string, unknown> = entry?.config ?? ('custom' in what ? what.custom.config : {});
      if (config.type === 'sse') return { ok: false, error: 'Codex supports stdio and streamable HTTP MCP servers; legacy SSE is unsupported' };
      if (config.type !== 'stdio' && config.type !== 'http') return { ok: false, error: 'Unsupported MCP transport' };
      const env = Object.entries(keys).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()] as const);
      if (env.some(([key]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) return { ok: false, error: 'Invalid environment variable name' };
      if ((entry?.keys ?? []).some((key) => !keys[key.name]?.trim())) return { ok: false, error: 'The required MCP server keys are missing' };
      if (config.type === 'http' && env.length) return { ok: false, error: 'HTTP servers take no environment keys here; add the server, then sign in' };
      const args = ['mcp', 'add', name];
      if (config.type === 'stdio') {
        if (typeof config.command !== 'string' || !config.command.trim() || (config.args != null && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string')))) return { ok: false, error: 'A stdio MCP server needs a command and string arguments' };
        for (const [key, value] of env) args.push('--env', `${key}=${value}`);
        args.push('--', config.command, ...(config.args as string[] | undefined ?? []));
      } else {
        try { const url = new URL(String(config.url)); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
        catch { return { ok: false, error: 'An HTTP MCP server needs an http:// or https:// URL' }; }
        args.push('--url', String(config.url));
      }
      let existing: NativeServer | undefined;
      try { existing = (await this.nativeServers()).find((server) => server.name === name); }
      catch { return { ok: false, error: 'Could not read the native Codex MCP configuration' }; }
      if (existing && !replace) return { ok: false, error: `${name} is already installed` };
      const wasAllowed = this.options.allowed().includes(`mcp__${name}`);
      say(`$ codex mcp add ${name} (configuration values hidden)`);
      const proc = codexProcess(this.options, args);
      proc.end();
      const result = await proc.result;
      // Native HTTP add can save configuration and then wait for OAuth. Verify the saved entry even on timeout.
      let saved: NativeServer | undefined;
      try { saved = (await this.nativeServers()).find((server) => server.name === name); } catch {}
      const matches = saved && (config.type === 'http' ? saved.transport.url === config.url : saved.transport.command === config.command && JSON.stringify(saved.transport.args ?? []) === JSON.stringify(config.args ?? []));
      if (!matches || (result.code !== 0 && config.type !== 'http')) return { ok: false, error: result.failure ? `Codex MCP install ${result.failure}` : 'Codex did not confirm the MCP configuration was saved' };
      this.allow(`mcp__${name}`, existing ? wasAllowed : !!entry);
      say(`■ ${existing ? 'updated' : 'installed'} ${name}${config.type === 'http' ? ' — use Sign in if authentication is required' : ''}`);
      this.options.log(`[mcp] codex ${existing ? 'updated' : 'installed'} ${name}`);
      return { ok: true, error: null };
    });
  }

  remove(name: string, say: (line: string) => void = () => {}): Promise<Result> {
    return this.serial(async () => {
      if (!SERVER_NAME.test(name)) return { ok: false, error: 'Invalid MCP server name' };
      if (!(await this.nativeServers()).some((server) => server.name === name)) return { ok: false, error: `${name} is not a native Codex MCP server` };
      const proc = codexProcess(this.options, ['mcp', 'remove', name]); proc.end();
      const result = await proc.result;
      if (result.code !== 0) return { ok: false, error: `Codex MCP remove ${result.failure ?? 'failed'}` };
      if ((await this.nativeServers()).some((server) => server.name === name)) return { ok: false, error: 'Codex did not confirm the server was removed' };
      this.allow(`mcp__${name}`, false);
      say(`■ removed ${name}`);
      return { ok: true, error: null };
    });
  }

  allow(prefix: string, on: boolean): string[] {
    if (!MCP_PREFIX.test(prefix)) throw new Error('Invalid MCP tool prefix');
    const next = this.options.allowed().filter((value) => value !== prefix);
    if (on) next.push(prefix);
    this.options.setAllowed(next);
    return next;
  }

  async startLogin(name: string): Promise<McpLoginSession> {
    if (!SERVER_NAME.test(name)) throw new Error('Invalid MCP server name');
    const row = (await this.nativeServers()).find((server) => server.name === name);
    if (!row) throw new Error('The MCP server is not configured in Codex');
    if (row.transport.type !== 'streamable_http') throw new Error('Only HTTP MCP servers support OAuth sign-in');
    const session = this.login.start(name);
    for (let waited = 0; !session.url && !session.done && waited < 5_000; waited += 50) await Bun.sleep(50);
    return session;
  }

  /** Reconnect starts a fresh native connection; it does not interrupt already-running goal sessions. */
  reconnect(): Promise<McpHealth[]> { return this.check(); }

  async doctorChecks(): Promise<DoctorCheck[]> {
    try {
      const view = await this.view();
      return view.catalog.filter((value) => value.entry.tier === 'recommended').map((value) => ({ id: `mcp:${value.entry.id}`, label: `${value.entry.name} MCP`, ok: value.installed, severity: 'warn' as const, detail: value.installed ? value.entry.summary : `Not installed in Codex — ${value.entry.why}`, fix: value.installed ? null : { url: '/skills?provider=codex#mcp' } }));
    } catch { return [{ id: 'mcp-catalog', label: 'Codex MCP catalog', ok: false, severity: 'warn', detail: 'Could not read the native Codex MCP configuration', fix: null }]; }
  }

  private async nativeServers(): Promise<NativeServer[]> {
    const proc = codexProcess(this.options, ['mcp', 'list', '--json']); proc.end();
    const result = await proc.result;
    if (result.code !== 0) throw new Error(`Codex MCP list ${result.failure ?? 'failed; check the native configuration'}`);
    let rows: unknown;
    try { rows = JSON.parse(result.stdout); } catch { throw new Error('Codex MCP returned invalid JSON'); }
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.name !== 'string' || !row.transport || typeof row.transport.type !== 'string')) throw new Error('Codex MCP returned an invalid server list');
    return rows;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
}

/** Native --no-browser flow uses a pipe, prints its link, and accepts the complete callback URL. */
class CodexMcpLogin {
  private current: McpLoginSession | null = null;
  private proc: ReturnType<typeof codexProcess> | null = null;
  constructor(private options: CodexMcpManagerOptions) {}
  session(): McpLoginSession | null { return this.current; }
  start(name: string): McpLoginSession {
    if (this.current && !this.current.done) throw new Error('Finish or cancel the current MCP sign-in first');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const command = `CODEX_HOME=${quote(this.options.codexHome)} ${quote(this.options.codexBin ?? 'codex')} mcp login ${name} --no-browser`;
    const session: McpLoginSession = { id: crypto.randomUUID(), name, connector: false, url: null, lines: [], needsCode: false, command, done: false, ok: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };
    this.current = session;
    let buffer = '';
    const proc = codexProcess({ ...this.options, timeoutMs: this.options.loginTimeoutMs ?? 10 * 60_000 }, ['mcp', 'login', name, '--no-browser'], (text) => {
      buffer = (buffer + text.replace(/\x1b\[[0-9;]*m/g, '')).slice(-64_000);
      // Only expose the authorization link itself. Native logs can include secrets or a pasted callback.
      const completeLines = buffer.slice(0, buffer.lastIndexOf('\n') + 1);
      const url = completeLines.match(/https?:\/\/[^\s"'<>]+/)?.[0];
      if (url && !session.url) { session.url = url; session.lines.push('Authorization link ready'); }
      if (/paste|callback url|redirect url/i.test(buffer)) session.needsCode = true;
    });
    this.proc = proc;
    void proc.result.then((result) => {
      if (session.done) return;
      this.finish(session, result.code === 0 && !result.failure, result.failure ?? (result.code === 0 ? null : 'Native MCP sign-in failed; update Codex if --no-browser is unsupported'));
      if (this.proc === proc) this.proc = null;
    });
    return session;
  }
  submit(value: string): McpLoginSession {
    const session = this.current;
    if (!session || session.done || !session.needsCode || !this.proc) throw new Error('No MCP sign-in is waiting for a callback URL');
    const url = value.trim();
    if (/[\r\n]/.test(url)) throw new Error('Paste one callback URL');
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error(); }
    catch { throw new Error('Paste the localhost callback URL from the sign-in page'); }
    this.proc.write(`${url}\n`);
    session.needsCode = false;
    return session;
  }
  cancel(): void { if (this.current && !this.current.done) this.finish(this.current, false, 'cancelled'); this.proc?.kill(); this.proc = null; }
  private finish(session: McpLoginSession, ok: boolean, error: string | null) { session.done = true; session.ok = ok; session.error = ok ? null : error; session.needsCode = false; session.finishedAt = new Date().toISOString(); this.options.log(`[mcp] codex login ${session.name} ${ok ? 'ok' : 'failed'}`); }
}
