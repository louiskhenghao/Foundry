import type { TaskKind, TaskScenario } from '@ai-engine/core';
import { SATISFIED } from './catalog.ts';
import type { CatalogEntryStatus, SkillRole } from './types.ts';
import { formatWorkflowSection, mandatedSkillsFor, type MandatedSkill } from './workflow.ts';

const MAX = 8;

/** One line, or null. Only catalog entries with a matching role tag that are actually installed. */
export function formatSkillsHint(role: SkillRole, statuses: CatalogEntryStatus[]): string | null {
  const invokes = statuses
    .filter((s) => SATISFIED.includes(s.status) && s.entry.roles.includes(role))
    .map((s) => s.entry.invoke ?? s.installedInvoke ?? `/${s.entry.name}`)
    .slice(0, MAX);
  if (!invokes.length) return null;
  return `Installed skills relevant to this role (use when appropriate): ${invokes.join(', ')}`;
}

export interface SectionOpts {
  taskKind?: TaskKind;
  scenario?: TaskScenario;
  /** skills autoskills installed in the goal workspace */
  projectSkills?: string[];
  /** goal/task discipline (see resolveDiscipline) */
  discipline?: { tdd: 'required' | 'preferred' | 'off' };
}

/** TTL-cached catalog statuses → prompt sections; the manager invalidates on install/uninstall. */
export class SkillsHints {
  private cache: { at: number; statuses: CatalogEntryStatus[] } | null = null;
  constructor(
    private load: () => Promise<CatalogEntryStatus[]>,
    private opts: { ttlMs?: number; enabled?: () => boolean; profile?: () => 'mattpocock' | 'plain'; packs?: () => Record<string, string | undefined> } = {},
  ) {}
  invalidate(): void {
    this.cache = null;
  }
  async statuses(): Promise<CatalogEntryStatus[] | null> {
    if (this.opts.enabled && !this.opts.enabled()) return null;
    const ttl = this.opts.ttlMs ?? 10_000;
    if (!this.cache || Date.now() - this.cache.at > ttl) {
      try {
        this.cache = { at: Date.now(), statuses: await this.load() };
      } catch {
        return null;
      }
    }
    return this.cache.statuses;
  }
  private packs(): Record<string, string | undefined> {
    return this.opts.packs?.() ?? {};
  }
  /** One-line hint (legacy / plain profile). */
  async hintFor(role: SkillRole): Promise<string | null> {
    const s = await this.statuses();
    return s ? formatSkillsHint(role, s) : null;
  }
  /** Full `# Workflow skills` section for a role (task kind, scenario), or null. */
  async sectionFor(role: SkillRole, opts: SectionOpts = {}): Promise<string | null> {
    const s = await this.statuses();
    if (!s) return null;
    return formatWorkflowSection({ role, taskKind: opts.taskKind, scenario: opts.scenario, projectSkills: opts.projectSkills, discipline: opts.discipline, profile: this.opts.profile?.() ?? 'mattpocock', statuses: s, packs: this.packs() });
  }
  /** Skills this role MUST invoke for this task kind / scenario (for the reviewer's note). */
  async mandatedFor(role: SkillRole, opts: SectionOpts = {}): Promise<MandatedSkill[]> {
    const s = await this.statuses();
    if (!s || (this.opts.profile?.() ?? 'mattpocock') === 'plain') return [];
    return mandatedSkillsFor({ role, taskKind: opts.taskKind, scenario: opts.scenario, discipline: opts.discipline, profile: 'mattpocock', statuses: s, packs: this.packs() });
  }
}
