/**
 * What this machine knows about model names, learned passively from sessions: the name the engine asked
 * for (`--model fable`) and the id Claude Code actually resolved it to (`claude-fable-5`), plus when it
 * last worked or failed. No hard-coded model knowledge beyond a seed list of family aliases.
 */
import type { AgentProvider } from '@foundry/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FailureClass, RunResult } from '@foundry/runner';
import type { CodexDiscoveredModel } from './codex-discover.ts';

export interface ModelRecord {
  name: string;
  resolvedId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastError: string | null;
  sessions: number;
  /** seed alias (always listed) vs learned from use */
  seed: boolean;
  /** found in the Claude Code binary by a model sync; `newest` = the latest id of its family */
  discovered?: { family: string; newest: boolean; at: string } | null;
  /** Native Codex catalog metadata. Presence in the catalog does not prove account entitlement. */
  codex?: {
    displayName: string | null;
    description: string | null;
    reasoningEfforts: string[];
    defaultReasoningEffort: string | null;
    isDefault: boolean;
    /** Present in the most recent successful catalog refresh; previously observed entries remain stored. */
    available: boolean;
  };
}

/** when the last model sync ran and against which Claude Code version (a new CLI version triggers one) */
export interface ModelSyncState {
  cliVersion: string | null;
  at: string | null;
  found: number;
}

/**
 * Family aliases Claude Code resolves to the latest release — a starting point, not the truth — plus one pinned
 * id: `fable` only reaches Fable 5.1 from Claude Code 2.1.259; on older CLIs the full id still goes through
 * (with a harmless `[claude-code:unrecognized_model]` stderr line).
 */
export const SEED_MODELS: { name: string; label: string; note: string }[] = [
  { name: 'fable', label: 'Fable', note: 'most capable (Mythos-class) — the Fable release your Claude Code knows' },
  { name: 'claude-fable-5-1', label: 'Fable 5.1', note: 'pinned id — works on any recent Claude Code' },
  { name: 'opus', label: 'Opus', note: 'strong, default' },
  { name: 'sonnet', label: 'Sonnet', note: 'fast, good for routine tasks' },
  { name: 'haiku', label: 'Haiku', note: 'cheapest' },
];

/** a full model id (dated or versioned), as opposed to a family alias */
export const isPinnedId = (name: string) => /^claude-/.test(name) || /\d{8}|\d+-\d+/.test(name);

/** `agy-default` follows the CLI's own choice; the account's models come from `agy models` (Sync models): they differ by tier */
export const AGY_SEED_MODELS: { name: string; label: string; note: string }[] = [{ name: 'agy-default', label: 'Antigravity default', note: 'the model the CLI itself is set to' }];

export class ModelRegistry {
  readonly path: string;
  private records = new Map<string, ModelRecord>();
  constructor(dataDir: string, provider: AgentProvider = 'claude') {
    this.path = join(dataDir, 'models.json');
    try {
      if (existsSync(this.path)) for (const r of JSON.parse(readFileSync(this.path, 'utf8')) as ModelRecord[]) this.records.set(r.name, r);
    } catch {}
    const now = new Date().toISOString();
    for (const s of provider === 'codex' ? [{ name: 'codex-default' }] : provider === 'agy' ? AGY_SEED_MODELS : SEED_MODELS) if (!this.records.has(s.name)) this.records.set(s.name, { name: s.name, resolvedId: null, firstSeenAt: now, lastSeenAt: now, lastOkAt: null, lastFailAt: null, lastError: null, sessions: 0, seed: true });
  }
  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify([...this.records.values()], null, 2));
    } catch {}
  }
  private upsert(name: string): ModelRecord {
    const now = new Date().toISOString();
    let r = this.records.get(name);
    if (!r) {
      r = { name, resolvedId: null, firstSeenAt: now, lastSeenAt: now, lastOkAt: null, lastFailAt: null, lastError: null, sessions: 0, seed: false };
      this.records.set(name, r);
    }
    r.lastSeenAt = now;
    return r;
  }
  /** a model sync found these ids in the Claude Code binary: add the unknown ones, refresh which is newest per family */
  noteDiscovered(models: { id: string; family: string; newest: boolean }[]): void {
    const at = new Date().toISOString();
    for (const r of this.records.values()) if (r.discovered) r.discovered = { ...r.discovered, newest: false };
    for (const m of models) {
      const r = this.records.get(m.id) ?? this.upsert(m.id);
      r.discovered = { family: m.family, newest: m.newest, at };
    }
    this.save();
  }
  /** Refresh catalog capabilities without treating discovery as a successful inference session. */
  noteCodexDiscovered(models: CodexDiscoveredModel[]): void {
    for (const r of this.records.values()) if (r.codex) r.codex = { ...r.codex, available: false };
    for (const model of models) {
      const r = this.upsert(model.id);
      r.codex = {
        displayName: model.displayName,
        description: model.description,
        reasoningEfforts: [...model.reasoningEfforts],
        defaultReasoningEffort: model.defaultReasoningEffort,
        isDefault: model.isDefault,
        available: true,
      };
    }
    this.save();
  }
  syncState(): ModelSyncState {
    try {
      return JSON.parse(readFileSync(join(dirname(this.path), 'models-sync.json'), 'utf8')) as ModelSyncState;
    } catch {
      return { cliVersion: null, at: null, found: 0 };
    }
  }
  noteSync(state: ModelSyncState): void {
    try {
      writeFileSync(join(dirname(this.path), 'models-sync.json'), JSON.stringify(state, null, 2));
    } catch {}
  }
  /** the CLI's `init` message told us what `name` resolves to */
  noteResolved(name: string, resolvedId: string | null): void {
    if (!name) return;
    const r = this.upsert(name);
    if (resolvedId) r.resolvedId = resolvedId;
    this.save();
  }
  /** a session that asked for `name` ended */
  noteResult(name: string, result: Pick<RunResult, 'subtype' | 'errorMessage' | 'failureClass' | 'numTurns' | 'modelUsage'>): void {
    if (!name) return;
    const r = this.upsert(name);
    r.sessions++;
    const fc: FailureClass | null | undefined = result.failureClass;
    // the model that did the work: Claude Code also bills a few haiku tokens per session for its own housekeeping
    const usage = result.modelUsage && typeof result.modelUsage === 'object' ? Object.entries(result.modelUsage as Record<string, { costUSD?: number; outputTokens?: number }>) : [];
    const resolved = usage.sort((a, b) => (b[1]?.costUSD ?? b[1]?.outputTokens ?? 0) - (a[1]?.costUSD ?? a[1]?.outputTokens ?? 0))[0]?.[0] ?? null;
    if (resolved) r.resolvedId = resolved;
    if (fc === 'model_unavailable') {
      r.lastFailAt = new Date().toISOString();
      r.lastError = (result.errorMessage ?? 'model unavailable').slice(0, 300);
    } else if (result.subtype === 'success' || result.numTurns > 0 || resolved) {
      r.lastOkAt = new Date().toISOString();
    }
    this.save();
  }
  get(name: string): ModelRecord | null {
    return this.records.get(name) ?? null;
  }
  list(): ModelRecord[] {
    return [...this.records.values()].sort((a, b) => Number(b.seed) - Number(a.seed) || a.name.localeCompare(b.name));
  }
  /** has this name ever resolved / succeeded here? */
  known(name: string): boolean {
    const r = this.records.get(name);
    return !!r && (!!r.resolvedId || !!r.lastOkAt);
  }
}

/**
 * The models `agy models` lists: one `slug<TAB>label` line each (agy 1.4.4; the command takes no --output-format), or a
 * JSON payload (an array, or an object holding one) should a later release print one.
 */
export function parseAgyModels(text: string): { id: string; label: string | null }[] {
  const out = new Map<string, string | null>();
  const take = (item: any) => {
    const id = typeof item === 'string' ? item : item?.slug ?? item?.id ?? item?.name ?? item?.model;
    if (typeof id === 'string' && id.trim()) out.set(id.trim(), typeof item === 'object' ? ((item.label ?? item.displayName ?? item.display_name ?? item.title) as string | undefined) ?? null : null);
  };
  let json: any = null;
  try {
    json = JSON.parse(text.trim());
  } catch {}
  if (json) {
    const list = Array.isArray(json) ? json : (json.models ?? json.data ?? json.items ?? json.structured_output ?? []);
    for (const item of Array.isArray(list) ? list : []) take(item);
  } else {
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z0-9][\w.-]*)(?:\t+|\s{2,})(.+?)\s*$/.exec(line);
      if (m) out.set(m[1]!, m[2]!);
    }
  }
  return [...out].map(([id, label]) => ({ id, label }));
}
