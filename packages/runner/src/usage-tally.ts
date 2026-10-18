/**
 * What a session used when the CLI never said. Claude Code reports `total_cost_usd`, `num_turns` and the usage totals
 * on its final `result` line only; a session the engine kills (time or idle limit, by hand) or that dies writes none,
 * and the engine used to book it as $0 and 0 turns — unknown became free. This tallies the per-message usage the
 * stream carries instead (one API message arrives as several lines, one per content block, each repeating the
 * message's opening usage, whose output count is its first few tokens) and reads the session's own record — Claude
 * Code's transcript under `<claude home>/projects/` — for the final counts. Dollars stay unknown: Foundry keeps no
 * price table, and an estimate presented as a measurement would be a second lie.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** token counts under the CLI's own key names, so `RunResult.usage` keeps the shape the engine reads */
export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface MessageUsage {
  /** the API message id: the same message arrives as several lines, one per content block */
  id: string;
  model: string | null;
  /** a helper agent's message: `parent_tool_use_id` on the stream, `isSidechain` in Claude Code's own record */
  subagent: boolean;
  usage: TokenCounts;
}

const KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;
const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

/** The per-message usage of one `assistant` message (a stream line or a record of the session's own transcript); null for anything else. */
export function assistantUsage(msg: any): MessageUsage | null {
  if (!msg || typeof msg !== 'object' || msg.type !== 'assistant') return null;
  const m = msg.message;
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id || !m.usage || typeof m.usage !== 'object') return null;
  return {
    id: m.id,
    model: typeof m.model === 'string' && m.model ? m.model : null,
    subagent: !!msg.parent_tool_use_id || msg.isSidechain === true,
    usage: { input_tokens: count(m.usage.input_tokens), output_tokens: count(m.usage.output_tokens), cache_read_input_tokens: count(m.usage.cache_read_input_tokens), cache_creation_input_tokens: count(m.usage.cache_creation_input_tokens) },
  };
}

/** Per-message token counts: one entry per API message, however many lines or records it arrived in. */
export class UsageTally {
  private byId = new Map<string, MessageUsage>();

  /** the larger count per field wins: a message's later records carry its final output count, its input counts never change */
  add(m: MessageUsage): void {
    const prev = this.byId.get(m.id);
    if (!prev) {
      this.byId.set(m.id, { ...m, usage: { ...m.usage } });
      return;
    }
    for (const k of KEYS) prev.usage[k] = Math.max(prev.usage[k], m.usage[k]);
    prev.model ??= m.model;
    prev.subagent ||= m.subagent;
  }
  addAll(ms: Iterable<MessageUsage>): void {
    for (const m of ms) this.add(m);
  }
  /** API messages seen, helper agents' included */
  get messages(): number {
    return this.byId.size;
  }
  /** API round trips of the main conversation — what the CLI's `num_turns` counts */
  turns(): number {
    let n = 0;
    for (const m of this.byId.values()) if (!m.subagent) n++;
    return n;
  }
  totals(): TokenCounts {
    const t: TokenCounts = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    for (const m of this.byId.values()) for (const k of KEYS) t[k] += m.usage[k];
    return t;
  }
  /** per model, in the shape of the CLI's `modelUsage` — without `costUSD`: unknown, not zero */
  byModel(): Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }> {
    const out: ReturnType<UsageTally['byModel']> = {};
    for (const m of this.byId.values()) {
      const row = (out[m.model ?? 'unknown'] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
      row.inputTokens += m.usage.input_tokens;
      row.outputTokens += m.usage.output_tokens;
      row.cacheReadInputTokens += m.usage.cache_read_input_tokens;
      row.cacheCreationInputTokens += m.usage.cache_creation_input_tokens;
    }
    return out;
  }
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The session's own record: Claude Code's transcript of the main conversation (`projects/<folder>/<session>.jsonl`)
 * and of its helper agents (`projects/<folder>/<session>/subagents/agent-*.jsonl`), when they exist under `claudeHome`.
 * Each message there is recorded once per content block as well, the later records carrying its final counts.
 */
export function readSessionRecord(claudeHome: string, sessionId: string): MessageUsage[] {
  if (!SESSION_ID.test(sessionId)) return [];
  const projects = join(claudeHome, 'projects');
  let folders: string[];
  try {
    folders = readdirSync(projects);
  } catch {
    return [];
  }
  for (const folder of folders) {
    const main = join(projects, folder, `${sessionId}.jsonl`);
    if (!existsSync(main)) continue;
    const out = usageInRecord(main, false);
    const subagents = join(projects, folder, sessionId, 'subagents');
    let names: string[] = [];
    try {
      names = readdirSync(subagents);
    } catch {}
    for (const name of names) if (name.endsWith('.jsonl')) out.push(...usageInRecord(join(subagents, name), true));
    return out;
  }
  return [];
}

function usageInRecord(path: string, subagent: boolean): MessageUsage[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: MessageUsage[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const u = assistantUsage(msg);
    if (u) out.push(subagent ? { ...u, subagent: true } : u);
  }
  return out;
}
