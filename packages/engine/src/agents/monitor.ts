import type { Attempt } from '@foundry/core';
import { statSync } from 'node:fs';
import { contextWindowFor } from './context-windows.ts';
import { CodexAgentsMonitor } from './codex-monitor.ts';
import { liveRegistry, listSubagents, recentTranscripts, subagentDone, TranscriptIndex, type TranscriptRef } from './scan.ts';
import { deriveMetaFromFile, firstLine, readSlice, tailLines, toLogItems, type Envelope, type TranscriptMeta } from './transcript.ts';
import type { AgentLogChunk, AgentSessionRow, AgentStatus, AgentsList, AgentsSummary } from './types.ts';

/** One engine-spawned Claude session that is currently in flight. */
export interface FoundryLiveSession {
  provider?: 'claude' | 'codex';
  taskId: string;
  goalId: string;
  attemptId: string | null;
  sessionId: string | null;
  pid: number | null;
  model: string | null;
  cwd: string | null;
  startedAt: string | null;
  killable: boolean;
}

export interface AgentsMonitorDeps {
  foundryLive: () => FoundryLiveSession[];
  /** attempts that ended at/after the given ISO time */
  foundryRecent: (sinceIso: string) => Attempt[];
  goalTitle: (goalId: string) => string | null;
  goalProvider?: (goalId: string) => 'claude' | 'codex';
  /** All known Foundry sessions, including older attempts and auxiliary sessions. */
  foundrySessionIds?: () => Iterable<string>;
  now?: () => number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BUSY_MS = 60_000;
const MAX_ROWS = 50;
const CACHE_MS = 2_000;

const iso = (ms: number | null | undefined) => (Number.isFinite(ms as number) ? new Date(ms as number).toISOString() : null);

/**
 * Read-through monitor over every Claude Code session on this machine: the engine's own in-flight
 * state for Foundry rows, plus ~/.claude (live registry + transcripts) for everything else.
 * Nothing is persisted; a short TTL cache keeps header polling cheap.
 */
export class AgentsMonitor {
  private index: TranscriptIndex;
  private metaCache = new Map<string, { mtimeMs: number; meta: TranscriptMeta; tail: Envelope[] }>();
  private cache: { at: number; list: AgentsList } | null = null;
  private codex: CodexAgentsMonitor | null;

  constructor(
    private opts: { includeExternal?: boolean; claudeHome: string; codexHome?: string; codexBin?: string; codexProcessHome?: string; codexTimeoutMs?: number; dataDir: string; /** roots of the progress folders (`<repo>-foundry/`), so runs the engine spawned there count as Foundry too */ workspaceRoots?: () => string[] },
    private deps: AgentsMonitorDeps,
  ) {
    this.index = new TranscriptIndex(opts.claudeHome);
    this.codex = opts.codexHome && opts.includeExternal !== false ? new CodexAgentsMonitor({ codexHome: opts.codexHome, codexBin: opts.codexBin, processHome: opts.codexProcessHome, timeoutMs: opts.codexTimeoutMs }, () => this.now()) : null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  stop(): void { this.codex?.stop(); }

  async list(): Promise<AgentsList> {
    const local = this.localList();
    if (!this.codex) return local;
    const owned = this.ownedSessions();
    for (const row of local.sessions) if (row.source === 'foundry') owned.add(row.sessionId);
    const external = await this.codex.list(owned);
    const order: Record<AgentStatus, number> = { busy: 0, idle: 1, unknown: 2, finished: 3 };
    const sessions = [...local.sessions, ...external.sessions].sort((a, b) => order[a.status] - order[b.status] || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')).slice(0, MAX_ROWS);
    const summary: AgentsSummary = { busy: 0, idle: 0, finished: 0, total: sessions.length };
    for (const row of sessions) summary[row.status] = (summary[row.status] ?? 0) + 1;
    return { sessions, summary, generatedAt: iso(this.now())!, ...(external.warning ? { warnings: [external.warning] } : {}) };
  }

  private ownedSessions(): Set<string> {
    const ids = new Set(this.deps.foundrySessionIds?.() ?? []);
    for (const session of this.deps.foundryLive()) if (session.sessionId) ids.add(session.sessionId);
    for (const attempt of this.deps.foundryRecent(new Date(this.now() - WINDOW_MS).toISOString())) {
      if (attempt.sessionId) ids.add(attempt.sessionId);
      for (const session of attempt.sessions ?? []) if (session.sessionId) ids.add(session.sessionId);
    }
    return ids;
  }

  private localList(): AgentsList {
    const now = this.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.list;

    const since = now - WINDOW_MS;
    const foundryIds = this.ownedSessions();
    const rows: AgentSessionRow[] = [];

    // Foundry in-flight — authoritative from engine state, no ~/.claude needed
    const live = this.deps.foundryLive();
    const liveAttemptIds = new Set(live.map((f) => f.attemptId).filter(Boolean) as string[]);
    for (const f of live) {
      if (f.sessionId) foundryIds.add(f.sessionId);
      rows.push({
        sessionId: f.sessionId ?? `foundry-${f.taskId}`,
        provider: f.provider ?? this.deps.goalProvider?.(f.goalId) ?? 'claude',
        source: 'foundry',
        entrypoint: 'foundry',
        status: 'busy',
        pid: f.pid,
        model: f.model,
        title: null,
        cwd: f.cwd,
        gitBranch: null,
        startedAt: f.startedAt,
        endedAt: null,
        lastActivityAt: iso(now),
        contextUsedTokens: null,
        contextWindowTokens: null,
        version: null,
        subagents: [],
        foundry: { goalId: f.goalId, goalTitle: this.deps.goalTitle(f.goalId), taskId: f.taskId, attemptId: f.attemptId, killable: f.killable },
      });
    }

    // Foundry finished — attempts that ended inside the window
    for (const a of this.deps.foundryRecent(new Date(since).toISOString())) {
      if (liveAttemptIds.has(a.id)) continue;
      if (a.sessionId) foundryIds.add(a.sessionId);
      for (const s of a.sessions ?? []) if (s.sessionId) foundryIds.add(s.sessionId);
      rows.push({
        sessionId: a.sessionId ?? `foundry-${a.id}`,
        provider: this.deps.goalProvider?.(a.goalId) ?? 'claude',
        source: 'foundry',
        entrypoint: 'foundry',
        status: 'finished',
        pid: a.pid,
        model: a.model,
        title: null,
        cwd: a.cwd,
        gitBranch: null,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        lastActivityAt: a.endedAt,
        contextUsedTokens: null,
        contextWindowTokens: null,
        version: null,
        subagents: [],
        foundry: { goalId: a.goalId, goalTitle: this.deps.goalTitle(a.goalId), taskId: a.taskId, attemptId: a.id, killable: false },
      });
    }

    // External live — ~/.claude/sessions registry minus anything Foundry owns
    const externalLiveIds = new Set<string>();
    for (const r of this.opts.includeExternal === false ? [] : liveRegistry(this.opts.claudeHome)) {
      if (foundryIds.has(r.sessionId)) continue;
      externalLiveIds.add(r.sessionId);
      const ref = this.index.find(r.sessionId);
      const mtime = ref?.mtimeMs ?? null;
      rows.push({
        sessionId: r.sessionId,
        provider: 'claude',
        source: 'external',
        entrypoint: r.entrypoint,
        status: mtime !== null && now - mtime <= BUSY_MS ? 'busy' : 'idle',
        pid: r.pid,
        model: null,
        title: r.name,
        cwd: r.cwd,
        gitBranch: null,
        startedAt: iso(r.startedAt),
        endedAt: null,
        lastActivityAt: iso(mtime),
        contextUsedTokens: null,
        contextWindowTokens: null,
        version: r.version,
        subagents: [],
        foundry: null,
      });
    }

    // External finished — transcripts touched in the window that belong to no live process
    for (const t of this.opts.includeExternal === false ? [] : recentTranscripts(this.opts.claudeHome, since)) {
      if (externalLiveIds.has(t.sessionId) || foundryIds.has(t.sessionId)) continue;
      this.index.remember(t);
      rows.push({
        sessionId: t.sessionId,
        provider: 'claude',
        source: 'external',
        entrypoint: null,
        status: 'finished',
        pid: null,
        model: null,
        title: null,
        cwd: null,
        gitBranch: null,
        startedAt: iso(t.birthtimeMs),
        endedAt: iso(t.mtimeMs),
        lastActivityAt: iso(t.mtimeMs),
        contextUsedTokens: null,
        contextWindowTokens: null,
        version: null,
        subagents: [],
        foundry: null,
      });
    }

    const order: Record<AgentStatus, number> = { busy: 0, idle: 1, finished: 2, unknown: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
    const capped = rows.slice(0, MAX_ROWS);

    // Tail-derive metadata only for rows that made the cut
    if (this.opts.includeExternal !== false) for (const row of capped) if (row.provider !== 'codex') this.enrich(row, now);

    const summary: AgentsSummary = { busy: 0, idle: 0, finished: 0, total: capped.length };
    for (const r of capped) summary[r.status] = (summary[r.status] ?? 0) + 1;
    const list: AgentsList = { sessions: capped, summary, generatedAt: iso(now)! };
    this.cache = { at: now, list };
    return list;
  }

  async summary(): Promise<AgentsSummary> {
    return (await this.list()).summary;
  }

  /** Incremental parsed log for an external session or a Task subagent. null = unknown session/agent. */
  async log(sessionId: string, agentId: string | null, offset: number): Promise<AgentLogChunk | null> {
    if (this.opts.includeExternal === false) return null;
    const path = agentId ? this.index.findSubagentLog(sessionId, agentId) : (this.index.find(sessionId)?.path ?? null);
    if (!path || !this.index.safe(path)) return this.codex?.log(sessionId, agentId, offset, this.ownedSessions()) ?? null;
    const slice = readSlice(path, offset);
    const alive = liveRegistry(this.opts.claudeHome).some((r) => r.sessionId === sessionId);
    let status: AgentStatus = 'finished';
    if (alive) {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {}
      status = this.now() - mtimeMs <= BUSY_MS ? 'busy' : 'idle';
    }
    return { items: toLogItems(slice.lines, { sidechain: agentId != null }), offset: slice.nextOffset, size: slice.size, eof: slice.eof, status };
  }

  private tailOf(ref: TranscriptRef): { meta: TranscriptMeta; tail: Envelope[] } {
    let mtimeMs = ref.mtimeMs;
    try {
      mtimeMs = statSync(ref.path).mtimeMs;
    } catch {}
    const hit = this.metaCache.get(ref.path);
    if (hit && hit.mtimeMs === mtimeMs) return hit;
    const tail = tailLines(ref.path);
    const meta = deriveMetaFromFile(ref.path);
    const entry = { mtimeMs, meta, tail };
    this.metaCache.set(ref.path, entry);
    return entry;
  }

  private enrich(row: AgentSessionRow, now: number): void {
    const ref = this.index.find(row.sessionId);
    if (!ref) {
      row.contextWindowTokens = row.model ? contextWindowFor(row.model, row.contextUsedTokens) : null;
      return;
    }
    const { meta, tail } = this.tailOf(ref);
    row.model = row.model ?? meta.model;
    // the AI-written title beats the registry's derived process name ("ai-engine-15")
    row.title = meta.title ?? row.title ?? meta.lastPrompt ?? meta.slug;
    row.cwd = row.cwd ?? meta.cwd;
    row.gitBranch = meta.gitBranch ?? row.gitBranch;
    row.version = row.version ?? meta.version;
    row.entrypoint = row.entrypoint ?? meta.entrypoint;
    row.contextUsedTokens = meta.contextUsedTokens;
    row.contextWindowTokens = contextWindowFor(row.model, meta.contextUsedTokens);
    if (row.startedAt === null) {
      const first = firstLine(ref.path);
      if (typeof first?.timestamp === 'string') row.startedAt = first.timestamp;
    }
    // headless runs the engine spawned into its worktrees also count as Foundry, even without a goal link
    if (row.source === 'external' && row.cwd && (row.cwd.startsWith(this.opts.dataDir) || (this.opts.workspaceRoots?.() ?? []).some((r) => row.cwd!.startsWith(r)))) row.source = 'foundry';
    row.subagents = listSubagents(ref.projDir, row.sessionId).map((s) => ({
      agentId: s.agentId,
      agentType: s.agentType,
      description: s.description,
      status: subagentDone(tail, s.toolUseId) || row.status === 'finished' ? 'done' : s.mtimeMs !== null && now - s.mtimeMs <= BUSY_MS ? 'running' : 'done',
      lastActivityAt: iso(s.mtimeMs),
    }));
  }
}
