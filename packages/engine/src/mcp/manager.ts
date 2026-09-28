import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { DoctorCheck } from '../skills/types.ts';
import { spawnStreaming } from '../skills/updaters.ts';
import { McpLogin, type LoginSpawn } from './login.ts';
import { listName, listServers, parseHealth, userPrefix } from './servers.ts';
import { McpCatalog, type McpCatalogEntry, type McpHealth, type McpView } from './types.ts';

type Spawn = (argv: string[], cwd: string, onLine: (l: string) => void, opts?: { timeoutMs?: number }) => Promise<{ code: number | null; tail: string }>;

export interface McpManagerOptions {
  claudeHome: string;
  catalogPath: string;
  claudeBin?: string;
  /** the MCP tool prefixes allowed in goals (Settings → workflow.mcpAllowed) */
  allowed: () => string[];
  setAllowed: (prefixes: string[]) => void;
  spawn?: Spawn;
  loginSpawn?: LoginSpawn;
  log: (msg: string) => void;
}

/** a server added by hand: stdio needs a command, http/sse a URL */
export interface CustomServer {
  name: string;
  config: { type: 'stdio'; command: string; args?: string[] } | { type: 'http' | 'sse'; url: string };
}

export const SERVER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
type Result = { ok: boolean; error: string | null };

/** MCP servers as Claude Code has them, the recommendations Foundry ships, and which ones goals may use (ADR-0016). */
export class McpManager {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: McpCatalog | null = null;
  /** `claude mcp login`: connectors get their claude.ai link; other HTTP servers their OAuth sign-in */
  readonly login: McpLogin;
  constructor(private o: McpManagerOptions) {
    this.login = new McpLogin({ claudeBin: () => this.claude(), headless: () => !!process.env.FOUNDRY_DOCKER || existsSync('/.dockerenv'), spawn: o.loginSpawn, log: o.log });
  }

  /**
   * Sign in to a connector or an HTTP server (stdio servers take their keys at install instead). Answers once the CLI
   * printed its link, finished, or 5 s passed, so the page opens on the link rather than on a spinner.
   */
  async startLogin(name: string) {
    const row = listServers(this.o.claudeHome, []).find((s) => s.name === name);
    if (!row) throw new Error(`no MCP server named ${name}`);
    if (row.source === 'plugin' || row.transport === 'stdio') throw new Error(`${name} does not sign in: it runs on this computer`);
    const s = this.login.start(name, row.source === 'connector');
    for (let waited = 0; !s.url && !s.done && waited < 5000; waited += 100) await Bun.sleep(100);
    return s;
  }

  catalog(): McpCatalog {
    this.cached ??= McpCatalog.parse(JSON.parse(readFileSync(this.o.catalogPath, 'utf8')));
    return this.cached;
  }

  view(): McpView {
    const entries = this.catalog().entries;
    const servers = listServers(this.o.claudeHome, this.o.allowed()).map((s) => ({ ...s, catalogId: s.source === 'user' ? (entries.find((e) => e.name === s.name)?.id ?? null) : null }));
    return { servers, catalog: entries.map((entry) => ({ entry, installed: servers.some((s) => s.source === 'user' && s.name === entry.name) })) };
  }

  /** `claude mcp list`: connects to every server, so it only runs when asked. */
  async check(): Promise<McpHealth[]> {
    const claude = this.claude();
    if (!claude) return [];
    const lines: string[] = [];
    await (this.o.spawn ?? spawnStreaming)([claude, 'mcp', 'list'], homedir(), (l) => lines.push(l), { timeoutMs: 120_000 });
    const health = parseHealth(lines.join('\n'));
    // report under the names the page lists
    const rows = listServers(this.o.claudeHome, []);
    return health.map((h) => ({ ...h, name: rows.find((r) => listName(r) === h.name)?.name ?? h.name }));
  }

  /** Install a catalog entry (then allowed in goals) or a custom server (off until switched on), at user scope. */
  install(what: { catalogId: string } | { custom: CustomServer }, keys: Record<string, string>, say: (l: string) => void = () => {}): Promise<Result> {
    return this.serial(async () => {
      const entry = 'catalogId' in what ? this.catalog().entries.find((e) => e.id === what.catalogId) : undefined;
      if ('catalogId' in what && !entry) return { ok: false, error: `no MCP catalog entry ${what.catalogId}` };
      const name = entry?.name ?? ('custom' in what ? what.custom.name : '');
      if (!SERVER_NAME.test(name)) return { ok: false, error: 'a server name is letters, digits, "_", "-" or "." (up to 64)' };
      const missing = (entry?.keys ?? []).filter((k) => !keys[k.name]?.trim()).map((k) => k.name);
      if (missing.length) return { ok: false, error: `${missing.join(', ')} is needed` };
      const env = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      const config = { ...(entry ? (entry.config as object) : 'custom' in what ? what.custom.config : {}), ...(Object.keys(env).length ? { env } : {}) };
      const r = await this.run(['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(config)], say, Object.values(env));
      if (!r.ok) return r;
      if (entry) this.allow(userPrefix(name), true);
      say(`■ installed ${name}${entry ? ' — allowed in goals' : ' — switch on "Allowed in goals" to let goals use it'}`);
      return r;
    });
  }

  /** Remove a user-scope server; it also leaves the user's own Claude Code. */
  remove(name: string, say: (l: string) => void = () => {}): Promise<Result> {
    return this.serial(async () => {
      if (!listServers(this.o.claudeHome, []).some((s) => s.source === 'user' && s.name === name)) return { ok: false, error: `${name} is not a user-scope MCP server` };
      const r = await this.run(['mcp', 'remove', '--scope', 'user', name], say);
      if (r.ok) {
        this.allow(userPrefix(name), false);
        say(`■ removed ${name}`);
      }
      return r;
    });
  }

  /** The "Allowed in goals" switch. */
  allow(prefix: string, on: boolean): string[] {
    if (!prefix.startsWith('mcp__')) throw new Error(`${prefix} is not an MCP tool prefix`);
    const now = this.o.allowed().filter((p) => p !== prefix);
    const next = on ? [...now, prefix] : now;
    this.o.setAllowed(next);
    return next;
  }

  /** Setup: a recommended server that is missing is a warning. */
  doctorChecks(): DoctorCheck[] {
    let v: McpView;
    try {
      v = this.view();
    } catch (e) {
      return [{ id: 'mcp-catalog', label: 'MCP catalog', ok: false, severity: 'warn', detail: `could not read ${this.o.catalogPath}: ${(e as Error).message}`, fix: null }];
    }
    return v.catalog
      .filter((c) => c.entry.tier === 'recommended')
      .map((c) =>
        c.installed
          ? { id: `mcp:${c.entry.id}`, label: `${c.entry.name} MCP`, ok: true, severity: 'warn' as const, detail: c.entry.summary, fix: null }
          : { id: `mcp:${c.entry.id}`, label: `${c.entry.name} MCP (recommended)`, ok: false, severity: 'warn' as const, detail: `not installed — ${c.entry.why}`, fix: { url: '/skills#mcp' } },
      );
  }

  private claude(): string | null {
    return this.o.claudeBin ?? Bun.which('claude');
  }

  /** run `claude …`, echoing the command with any key replaced by •••• */
  private async run(args: string[], say: (l: string) => void, secrets: string[] = []): Promise<Result> {
    const claude = this.claude();
    if (!claude) return { ok: false, error: 'claude not found on PATH' };
    const hide = (s: string) => secrets.reduce((t, k) => t.split(k).join('••••'), s);
    say(`$ claude ${hide(args.join(' '))}`);
    const r = await (this.o.spawn ?? spawnStreaming)([claude, ...args], homedir(), (l) => say(hide(l)), { timeoutMs: 120_000 });
    this.o.log(`[mcp] claude ${args.slice(0, 4).join(' ')} → ${r.code}`);
    return r.code === 0 ? { ok: true, error: null } : { ok: false, error: hide(r.tail).trim().slice(-300) || `claude exited ${r.code}` };
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const p = this.queue.then(work, work);
    this.queue = p.catch(() => {});
    return p;
  }
}

export type { McpCatalogEntry };
