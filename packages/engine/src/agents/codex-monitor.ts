import type { CodexProcessOptions } from '../mcp/codex-process.ts';
import { CodexHistoryClient } from './codex-client.ts';
import type { AgentLogChunk, AgentLogItem, AgentSessionRow } from './types.ts';

const TTL = 20_000;
const LOG_TTL = 5_000;
const MAX_THREADS = 200;
const MAX_ITEMS = 200;
const text = (value: unknown, limit = 16_000) => typeof value === 'string' ? value.slice(0, limit) : '';
const json = (value: unknown) => text(JSON.stringify(value ?? null));
const iso = (value: unknown, multiplier = 1_000): string | null => typeof value === 'number' && Number.isFinite(value) ? new Date(value * multiplier).toISOString() : null;
const parentId = (thread: any): string | null => thread.parentThreadId ?? thread.source?.subAgent?.thread_spawn?.parent_thread_id ?? null;

interface LogCache { at: number; items: AgentLogItem[]; base: number; fingerprints: Map<string, string> }

export class CodexAgentsMonitor {
  private client: CodexHistoryClient;
  private cached: { at: number; threads: any[]; warning?: string } | null = null;
  private pending: Promise<void> | null = null;
  private logs = new Map<string, LogCache>();
  private logPending = new Map<string, Promise<void>>();
  constructor(options: CodexProcessOptions, private now: () => number = Date.now) { this.client = new CodexHistoryClient(options); }
  stop(): void { this.client.stop(); }

  async list(owned: Set<string>): Promise<{ sessions: AgentSessionRow[]; warning?: string }> {
    if (!this.cached || this.now() - this.cached.at >= TTL) {
      this.pending ??= this.refresh().finally(() => { this.pending = null; });
      await this.pending;
    }
    const threads = this.cached?.threads ?? [];
    // A Foundry-owned parent also owns its native children, even if they have no attempt row of their own.
    for (let i = 0; i < 8; i++) for (const thread of threads) if (parentId(thread) && owned.has(parentId(thread)!)) owned.add(thread.id);
    const visible = threads.filter((thread) => !owned.has(thread.id));
    const sessions: AgentSessionRow[] = visible.filter((thread) => !visible.some((parent) => parent.id === parentId(thread))).map((thread) => ({
      sessionId: thread.id, provider: 'codex', source: 'external', entrypoint: typeof thread.source === 'string' ? thread.source : 'codex-subagent',
      status: 'unknown', pid: null, model: thread.model ?? null, title: text(thread.name || thread.preview, 500) || null, cwd: thread.cwd ?? null,
      gitBranch: thread.gitInfo?.branch ?? null, startedAt: iso(thread.createdAt), endedAt: null, lastActivityAt: iso(thread.updatedAt),
      contextUsedTokens: null, contextWindowTokens: null, version: thread.cliVersion ?? null, foundry: null,
      subagents: visible.filter((child) => parentId(child) === thread.id).map((child) => ({ agentId: child.id, agentType: child.agentRole ?? 'Codex subagent', description: text(child.name || child.preview, 500), status: 'unknown', lastActivityAt: iso(child.updatedAt) })),
    }));
    return { sessions, ...(this.cached?.warning ? { warning: this.cached.warning } : {}) };
  }

  private async refresh(): Promise<void> {
    try {
      const { threads, truncated } = await this.client.read(async (request) => {
        const threads: any[] = [];
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 4; page++) {
          const response = await request('thread/list', { limit: 50, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true, sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'], ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(response?.data) || response.data.some((thread: any) => !thread || typeof thread.id !== 'string')) throw new Error('Codex returned an invalid external thread list');
          const recent = response.data.filter((thread: any) => typeof thread.updatedAt === 'number' && thread.updatedAt * 1_000 >= this.now() - 86_400_000);
          threads.push(...recent.slice(0, MAX_THREADS - threads.length));
          if (!response.nextCursor || recent.length < response.data.length) return { threads, truncated: false };
          if (typeof response.nextCursor !== 'string' || cursors.has(response.nextCursor)) throw new Error('Codex returned an invalid thread pagination cursor');
          cursor = response.nextCursor; cursors.add(cursor!);
        }
        return { threads, truncated: true };
      });
      this.cached = { at: this.now(), threads, ...(truncated ? { warning: 'External Codex sessions are limited to the 200 most recently updated threads in the last 24 hours' } : {}) };
    } catch (error) {
      this.cached = { at: this.now(), threads: this.cached?.threads ?? [], warning: `${error instanceof Error ? error.message : 'Could not read external Codex sessions'}${this.cached?.threads.length ? '; showing the last successful snapshot' : ''}` };
    }
  }

  async log(sessionId: string, agentId: string | null, offset: number, owned: Set<string>): Promise<AgentLogChunk | null> {
    const list = await this.list(owned);
    const row = list.sessions.find((session) => session.sessionId === sessionId);
    if (!row || (agentId && !row.subagents.some((agent) => agent.agentId === agentId))) return null;
    const id = agentId ?? sessionId;
    const cached = this.logs.get(id);
    if (!cached || this.now() - cached.at >= LOG_TTL) {
      if (!this.logPending.has(id)) this.logPending.set(id, this.refreshLog(id).finally(() => { this.logPending.delete(id); }));
      await this.logPending.get(id);
    }
    const log = this.logs.get(id)!;
    const from = Math.max(log.base, Math.min(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0, log.base + log.items.length));
    const items = log.items.slice(from - log.base, from - log.base + 200);
    const next = from + items.length;
    return { items, offset: next, size: log.base + log.items.length, eof: next >= log.base + log.items.length, status: 'unknown' };
  }

  private async refreshLog(id: string): Promise<void> {
    const entries = await this.client.read(async (request) => {
      const metadata = await request('thread/read', { threadId: id, includeTurns: false });
      if (metadata?.thread?.id !== id) throw new Error('Codex returned a different thread');
      const turns = await request('thread/turns/list', { threadId: id, limit: 20, sortDirection: 'desc', itemsView: 'notLoaded' });
      if (!Array.isArray(turns?.data)) throw new Error('Codex returned invalid turn metadata');
      const dates = new Map<string, string | null>(turns.data.map((turn: any) => [turn.id, iso(turn.startedAt)]));
      const entries: { key: string; items: AgentLogItem[] }[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 2; page++) {
        const response = await request('thread/items/list', { threadId: id, limit: 100, sortDirection: 'desc', ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(response?.data)) throw new Error('Codex returned invalid thread items');
        for (const entry of response.data.slice(0, MAX_ITEMS - entries.length)) {
          if (!entry?.item || typeof entry.item.id !== 'string') continue;
          entries.push({ key: `${entry.turnId}:${entry.item.id}`, items: logItems(entry.item, iso(entry.startedAtMs, 1) ?? dates.get(entry.turnId) ?? null, metadata.thread.model ?? null) });
        }
        if (!response.nextCursor) break;
        if (typeof response.nextCursor !== 'string' || cursors.has(response.nextCursor)) throw new Error('Codex returned an invalid item pagination cursor');
        cursor = response.nextCursor; cursors.add(cursor!);
      }
      return entries.reverse();
    });
    let cached = this.logs.get(id);
    if (!cached) cached = { at: 0, base: 0, fingerprints: new Map(), items: [{ kind: 'notice', text: 'Recent Codex history (up to 200 native items per refresh). External process status is unavailable.', ts: null }] };
    for (const entry of entries) {
      const fingerprint = Bun.hash(JSON.stringify(entry.items)).toString();
      if (cached.fingerprints.get(entry.key) === fingerprint) continue;
      cached.items.push(...entry.items);
      cached.fingerprints.set(entry.key, fingerprint);
    }
    if (cached.items.length > 1_000) { const drop = cached.items.length - 1_000; cached.items.splice(0, drop); cached.base += drop; }
    let bytes = cached.items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
    while (bytes > 512_000 && cached.items.length > 1) { bytes -= JSON.stringify(cached.items.shift()!).length; cached.base++; }
    while (cached.fingerprints.size > 1_000) cached.fingerprints.delete(cached.fingerprints.keys().next().value!);
    cached.at = this.now(); this.logs.delete(id); this.logs.set(id, cached);
    while (this.logs.size > 20) this.logs.delete(this.logs.keys().next().value!);
  }
}

function logItems(item: any, ts: string | null, model: string | null): AgentLogItem[] {
  switch (item.type) {
    case 'userMessage': return [{ kind: 'user', text: (item.content ?? []).map((entry: any) => entry.type === 'text' ? text(entry.text) : `[${text(entry.type, 40)} attachment]`).join('\n'), ts }];
    case 'agentMessage': return [{ kind: 'assistant', text: text(item.text), model, ts }];
    case 'reasoning': return [{ kind: 'thinking', text: [...(item.summary ?? []), ...(item.content ?? [])].map((value) => text(value)).join('\n').slice(0, 16_000), ts }];
    case 'commandExecution': return [{ kind: 'tool_use', id: item.id, name: 'Bash', input: text(item.command), ts }, { kind: 'tool_result', forId: item.id, content: text(item.aggregatedOutput), isError: item.status === 'failed' || (item.exitCode != null && item.exitCode !== 0), ts }];
    case 'mcpToolCall': return [{ kind: 'tool_use', id: item.id, name: `mcp__${text(item.server, 100)}__${text(item.tool, 100)}`, input: json(item.arguments), ts }, ...(item.result || item.error ? [{ kind: 'tool_result' as const, forId: item.id, content: json(item.error ?? item.result), isError: !!item.error, ts }] : [])];
    case 'fileChange': return [{ kind: 'tool_use', id: item.id, name: 'apply_patch', input: json(item.changes), ts }];
    case 'collabAgentToolCall': return [{ kind: 'tool_use', id: item.id, name: `Agent:${text(item.tool, 100)}`, input: json({ receivers: item.receiverThreadIds, prompt: item.prompt }), ts }];
    case 'plan': return [{ kind: 'notice', text: text(item.text), ts }];
    default: return [{ kind: 'notice', text: `Native Codex item: ${text(item.type, 100)}`, ts }];
  }
}
