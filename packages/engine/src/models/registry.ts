/**
 * What this machine knows about model names, learned passively from sessions: the name the engine asked
 * for (`--model fable`) and the id Claude Code actually resolved it to (`claude-fable-5`), plus when it
 * last worked or failed. No hard-coded model knowledge beyond a seed list of family aliases.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FailureClass, RunResult } from '@foundry/runner';

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
}

/** family aliases Claude Code resolves to the latest release — a starting point, not the truth */
export const SEED_MODELS: { name: string; label: string; note: string }[] = [
  { name: 'fable', label: 'Fable 5', note: 'most capable (Mythos-class)' },
  { name: 'opus', label: 'Opus', note: 'strong, default' },
  { name: 'sonnet', label: 'Sonnet', note: 'fast, good for routine tasks' },
  { name: 'haiku', label: 'Haiku', note: 'cheapest' },
];

/** a full model id (dated or versioned), as opposed to a family alias */
export const isPinnedId = (name: string) => /^claude-/.test(name) || /\d{8}|\d+-\d+/.test(name);

export class ModelRegistry {
  readonly path: string;
  private records = new Map<string, ModelRecord>();
  constructor(dataDir: string) {
    this.path = join(dataDir, 'models.json');
    try {
      if (existsSync(this.path)) for (const r of JSON.parse(readFileSync(this.path, 'utf8')) as ModelRecord[]) this.records.set(r.name, r);
    } catch {}
    const now = new Date().toISOString();
    for (const s of SEED_MODELS) if (!this.records.has(s.name)) this.records.set(s.name, { name: s.name, resolvedId: null, firstSeenAt: now, lastSeenAt: now, lastOkAt: null, lastFailAt: null, lastError: null, sessions: 0, seed: true });
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
    const resolved = result.modelUsage && typeof result.modelUsage === 'object' ? Object.keys(result.modelUsage as object)[0] : null;
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
