/**
 * Memory (ADR-0071): a Hindsight server the person runs remembers what a folder's goals did and taught, and Foundry's
 * stages ask it before they start. Everything here is optional and bounded: with no server address nothing happens,
 * a server that does not answer costs a stage its timeout and nothing else, a write that fails is a record on the goal
 * and is not retried. The bank is named as Hindsight's own coding-agent integration names it, so the person's own
 * sessions in the repository and Foundry's goals share one memory.
 */
import { resolve } from 'node:path';
import { SECRET_SETTINGS, type AgentProvider, type MemorySettings } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { PreviewEnvStore, redactor } from '../preview/env.ts';
import { BANK_PREFIX, bankIdFor } from './bank.ts';
import { HindsightBackend } from './client.ts';
import { recentCommits, seedDocument } from './seed.ts';
import type { MemoryBackend, MemoryConnection, MemoryDocument, MemoryFolderStatus, MemorySource, MemoryStage, MemoryStatus } from './types.ts';

/** a stage waits this long for the server's answer, then goes on without one */
export const REFLECT_TIMEOUT_MS = 20_000;
/** what a stage is given of the answer */
export const REFLECT_MAX_CHARS = 1_500;
export const RETAIN_TIMEOUT_MS = 30_000;
/** the server's name in each coding agent's MCP configuration, and its tool prefix (ADR-0016) */
export const MCP_SERVER_NAME = 'hindsight';
export const MCP_SERVER_PREFIX = `mcp__${MCP_SERVER_NAME}`;
/** the variable Codex sessions (and the person's own shell) read the bearer token from */
export const TOKEN_ENV = 'HINDSIGHT_API_TOKEN';

/** what a bank Foundry creates is for; a bank that exists keeps whatever mission it has */
const BANK_MISSION =
  'This bank is the memory of one software repository: how it is built, tested and run; its conventions and the pitfalls met in it; the decisions made in it and why; what its reviews refused; what was tried there and failed. Keep exact identifiers, paths, commands and values verbatim. A later fact about the same thing supersedes an earlier one.';

export type BackendFactory = (c: MemoryConnection) => MemoryBackend;
/** test seam (engine.memoryDeps): a fake server, and timeouts a test can afford to wait for */
export interface MemoryDeps {
  backend?: BackendFactory;
  reflectTimeoutMs?: number;
  retainTimeoutMs?: number;
}

export interface MemoryWhere {
  repoPath: string;
  goalId: string | null;
  taskId?: string | null;
  attemptId?: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const message = (err: unknown) => clip(String((err as Error)?.message ?? err), 300);
/** environment entries that are credentials, by their names */
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD)/;

/** the token Codex sessions read (ADR-0071): only while Memory is on and the server asks for one */
export function memorySessionEnv(s: MemorySettings): Record<string, string> {
  return s.url && s.token ? { [TOKEN_ENV]: s.token } : {};
}

export class Memory {
  private backend: { conn: MemoryConnection; impl: MemoryBackend } | null = null;
  /** repoPath → its bank id, resolved once (a folder does not change repository) */
  private banks = new Map<string, Promise<string | null>>();
  /** repoPath → its bank made ready on the server (created, seeded) once per process */
  private ready = new Map<string, Promise<string | null>>();
  private pending = new Set<Promise<unknown>>();
  private previewEnv: PreviewEnvStore;

  constructor(private engine: Engine) {
    this.previewEnv = new PreviewEnvStore(engine.config.dataDir);
  }

  settings(): MemorySettings {
    return this.engine.settings.values().memory;
  }
  /** a server address is set */
  enabled(): boolean {
    return !!this.settings().url;
  }
  connection(): MemoryConnection | null {
    const s = this.settings();
    return s.url ? { url: s.url.replace(/\/+$/, ''), token: s.token } : null;
  }
  /** the folder is left out (Settings → memory.excludedFolders, switched on the Learnings page) */
  excluded(repoPath: string): boolean {
    const p = resolve(repoPath);
    return this.settings().excludedFolders.some((f) => resolve(f) === p);
  }
  /** the settings changed: the next call connects anew, and every bank is made ready again */
  reconfigure(): void {
    this.backend = null;
    this.ready.clear();
  }

  private client(): MemoryBackend | null {
    const conn = this.connection();
    if (!conn) return null;
    if (!this.backend || this.backend.conn.url !== conn.url || this.backend.conn.token !== conn.token) {
      const make = this.engine.memoryDeps.backend ?? ((c: MemoryConnection) => new HindsightBackend(c));
      this.backend = { conn, impl: make(conn) };
    }
    return this.backend.impl;
  }
  private timeout(kind: 'reflect' | 'retain'): AbortSignal {
    const d = this.engine.memoryDeps;
    return AbortSignal.timeout(kind === 'reflect' ? (d.reflectTimeoutMs ?? REFLECT_TIMEOUT_MS) : (d.retainTimeoutMs ?? RETAIN_TIMEOUT_MS));
  }

  /** the bank a folder's goals use, Memory on or off; null for a folder that is no repository */
  bankOf(repoPath: string): Promise<string | null> {
    let p = this.banks.get(repoPath);
    if (!p) {
      p = bankIdFor(repoPath);
      this.banks.set(repoPath, p);
      // a folder that is no repository yet may become one: ask again next time
      p.then((b) => b === null && this.banks.delete(repoPath), () => this.banks.delete(repoPath));
    }
    return p;
  }

  /** the bank Memory uses for this folder: on, the folder not left out, and a repository; else null */
  async bankFor(repoPath: string): Promise<string | null> {
    if (!this.enabled() || this.excluded(repoPath)) return null;
    return this.bankOf(repoPath);
  }

  async folderStatus(repoPath: string): Promise<MemoryFolderStatus> {
    const bank = await this.bankOf(repoPath);
    const excluded = this.excluded(repoPath);
    return { repoPath, bank, excluded, enabled: this.enabled() && !excluded && bank !== null };
  }

  /** leave a folder out of Memory, or take it back in */
  setFolder(repoPath: string, on: boolean): void {
    const p = resolve(repoPath);
    const rest = this.settings().excludedFolders.filter((f) => resolve(f) !== p);
    this.engine.updateSettings({ memory: { excludedFolders: on ? rest : [...rest, p] } });
  }

  /**
   * The folder's bank, made ready once per process: created with a mission for a coding project when the server has
   * none of that name (a bank that exists keeps its settings), then seeded from the repository's recent commits when it
   * holds no document yet. A failure is forgotten, so the next stage tries again.
   */
  ensureBank(repoPath: string): Promise<string | null> {
    const have = this.ready.get(repoPath);
    if (have) return have;
    const p = this.prepare(repoPath).catch((err) => {
      this.engine.config.log(`[memory] ${repoPath}: the server did not answer (${message(err)})`);
      this.ready.delete(repoPath);
      return null;
    });
    this.ready.set(repoPath, p);
    return p;
  }

  private async prepare(repoPath: string): Promise<string | null> {
    const bank = await this.bankFor(repoPath);
    const backend = this.client();
    if (!bank || !backend) return null;
    const signal = this.timeout('retain');
    if (!(await backend.listBanks(signal)).includes(bank)) await backend.createBank(bank, { name: bank.slice(BANK_PREFIX.length), mission: BANK_MISSION }, signal);
    if (!(await backend.hasDocuments(bank, signal))) this.track(this.seed(repoPath, bank));
    return bank;
  }

  /** the repository's recent commits, one document each, a few at a time (the server extracts each with its LLM) */
  private async seed(repoPath: string, bank: string): Promise<void> {
    const commits = await recentCommits(repoPath, this.settings().seedCommits);
    const backend = this.client();
    if (!commits.length || !backend) return;
    let written = 0;
    let chars = 0;
    let error: string | null = null;
    for (let i = 0; i < commits.length && !this.engine.isStopped; i += 4) {
      await Promise.all(
        commits.slice(i, i + 4).map(async (c) => {
          const doc = this.scrub(seedDocument(c));
          try {
            await backend.retain(bank, doc, this.timeout('retain'));
            written++;
            chars += doc.content.length;
          } catch (err) {
            error = message(err);
          }
        }),
      );
    }
    this.engine.store.append({ type: 'memory.retained', goalId: null, payload: { source: 'git', bankId: bank, documentId: null, count: written, chars, error, taskId: null, attemptId: null } });
    this.engine.config.log(`[memory] ${bank}: seeded ${written} of ${commits.length} commits${error ? ` (${error})` : ''}`);
  }

  /** the values of the credentials Foundry keeps, blanked out of everything it sends to the server */
  private scrub(doc: MemoryDocument): MemoryDocument {
    const s = this.engine.settings.values() as unknown as Record<string, Record<string, unknown>>;
    const values: unknown[] = [
      ...SECRET_SETTINGS.map((p) => {
        const [section, key] = p.split('.');
        return s[section!]?.[key!];
      }),
      ...Object.entries(this.engine.sessionEnvExtra()).flatMap(([k, v]) => (SECRET_ENV.test(k) ? [v] : [])),
      ...Object.values(this.previewEnv.all()).flatMap((vars) => Object.values(vars)),
    ];
    const redact = redactor(values.filter((v): v is string => typeof v === 'string'));
    return { ...doc, content: redact(doc.content), context: redact(doc.context) };
  }

  /** write one document into the folder's bank; false when Memory is off for the folder or the server refused */
  async retain(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): Promise<boolean> {
    const bank = await this.ensureBank(where.repoPath);
    const backend = this.client();
    if (!bank || !backend) return false;
    const scrubbed = this.scrub(doc);
    const base = { source: where.source, bankId: bank, documentId: doc.documentId ?? null, chars: scrubbed.content.length, taskId: where.taskId ?? null, attemptId: where.attemptId ?? null };
    try {
      await backend.retain(bank, scrubbed, this.timeout('retain'));
      this.engine.store.append({ type: 'memory.retained', goalId: where.goalId, payload: { ...base, count: 1, error: null } });
      return true;
    } catch (err) {
      const error = message(err);
      this.engine.store.append({ type: 'memory.retained', goalId: where.goalId, payload: { ...base, count: 0, error } });
      this.engine.config.log(`[memory] ${bank}: could not write the ${where.source} (${error})`);
      return false;
    }
  }

  /** write in the background; stop() waits for it */
  retainLater(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): void {
    this.track(this.retain(doc, where));
  }

  /**
   * What the bank answers a stage before it starts, cut to what a prompt can take; null when Memory is off for the
   * folder, the server did not answer in time, or it had nothing to say. Every ask is recorded on the goal.
   */
  async reflect(stage: MemoryStage, question: string, where: MemoryWhere & { context?: string }): Promise<string | null> {
    const bank = await this.ensureBank(where.repoPath);
    const backend = this.client();
    if (!bank || !backend) return null;
    const t0 = Date.now();
    const base = { stage, bankId: bank, query: question, taskId: where.taskId ?? null, attemptId: where.attemptId ?? null };
    try {
      const answer = await backend.reflect(bank, question, { budget: 'low', context: where.context, signal: this.timeout('reflect') });
      const text = clip(answer.trim(), REFLECT_MAX_CHARS) || null;
      this.engine.store.append({ type: 'memory.recalled', goalId: where.goalId, payload: { ...base, text, ms: Date.now() - t0, error: null } });
      return text;
    } catch (err) {
      const error = message(err);
      this.engine.store.append({ type: 'memory.recalled', goalId: where.goalId, payload: { ...base, text: null, ms: Date.now() - t0, error } });
      this.engine.config.log(`[memory] ${bank}: no answer for the ${stage} (${error})`);
      return null;
    }
  }

  /** the Hindsight card: is a server set, does it answer, and how each coding agent has its MCP server */
  async status(): Promise<MemoryStatus> {
    const s = this.settings();
    const conn = this.connection();
    let reachable: boolean | null = null;
    let version: string | null = null;
    let error: string | null = null;
    if (conn) {
      try {
        version = await this.client()!.version(AbortSignal.timeout(4_000));
        reachable = true;
      } catch (err) {
        reachable = false;
        error = message(err);
      }
    }
    return {
      configured: !!conn,
      url: conn?.url ?? null,
      tokenSet: !!conn?.token,
      reachable,
      version,
      error,
      retainTranscripts: s.retainTranscripts,
      seedCommits: s.seedCommits,
      excludedFolders: s.excludedFolders,
      mcp: { claude: this.mcpState('claude'), codex: await this.codexMcpState() },
    };
  }

  private mcpState(provider: 'claude'): { installed: boolean; allowed: boolean } | null {
    try {
      const installed = this.engine.mcpFor(provider).view();
      return { installed: 'servers' in installed && installed.servers.some((r) => r.source === 'user' && r.name === MCP_SERVER_NAME), allowed: this.engine.config.mcpAllowed.includes(MCP_SERVER_PREFIX) };
    } catch {
      return null;
    }
  }
  private async codexMcpState(): Promise<{ installed: boolean; allowed: boolean } | null> {
    try {
      const view = await this.engine.codexMcp.view();
      return { installed: view.servers.some((r) => r.name === MCP_SERVER_NAME), allowed: this.engine.config.codexMcpAllowed.includes(MCP_SERVER_PREFIX) };
    } catch {
      return null;
    }
  }

  /** try an address before saving it */
  async probe(conn: MemoryConnection): Promise<{ ok: boolean; version: string | null; error: string | null }> {
    const make = this.engine.memoryDeps.backend ?? ((c: MemoryConnection) => new HindsightBackend(c));
    try {
      return { ok: true, version: await make({ ...conn, url: conn.url.replace(/\/+$/, '') }).version(AbortSignal.timeout(5_000)), error: null };
    } catch (err) {
      return { ok: false, version: null, error: message(err) };
    }
  }

  /**
   * The hindsight MCP server in a coding agent's own configuration (user scope, ADR-0016), at the server's multi-bank
   * endpoint, then allowed in goals: a worker is told its bank and may ask the memory itself. Claude Code takes the
   * token as a header; Codex reads it from the session's environment. Antigravity keeps its MCP servers itself.
   */
  installMcp(provider: AgentProvider, say: (line: string) => void = () => {}): Promise<{ ok: boolean; error: string | null }> {
    const conn = this.connection();
    if (!conn) return Promise.resolve({ ok: false, error: 'set the server address first' });
    if (provider === 'agy') return Promise.resolve({ ok: false, error: 'Antigravity keeps its MCP servers itself: add it with agy mcp add' });
    const url = `${conn.url}/mcp/`;
    const config = provider === 'claude' ? { type: 'http' as const, url, ...(conn.token ? { headers: { Authorization: `Bearer ${conn.token}` } } : {}) } : { type: 'http' as const, url, ...(conn.token ? { bearerTokenEnvVar: TOKEN_ENV } : {}) };
    const manager = this.engine.mcpFor(provider);
    return manager.install({ custom: { name: MCP_SERVER_NAME, config } }, {}, say, true).then((r) => {
      if (r.ok) manager.allow(MCP_SERVER_PREFIX, true);
      return r;
    });
  }

  removeMcp(provider: AgentProvider, say: (line: string) => void = () => {}): Promise<{ ok: boolean; error: string | null }> {
    if (provider === 'agy') return Promise.resolve({ ok: false, error: 'Antigravity keeps its MCP servers itself' });
    return this.engine.mcpFor(provider).remove(MCP_SERVER_NAME, say);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p)).catch(() => {});
    return p;
  }
  /** writes still in flight (stop() waits for them, bounded) */
  pendingWork(): Promise<unknown>[] {
    return [...this.pending];
  }
}
