import type { Brief, BriefArea, BriefTask } from '../schema/brief.ts';
import { depths } from './dag.ts';

/** A Brief with more tasks than this is "large": the UI warns, nothing is blocked. */
export const LARGE_BRIEF_TASKS = 12;

/** Areas that have no task yet. Coverage means every Area has at least one. */
export function uncoveredAreas(brief: Pick<Brief, 'areas' | 'tasks'>): BriefArea[] {
  const used = new Set(brief.tasks.map((t) => t.areaKey));
  return brief.areas.filter((a) => !used.has(a.key));
}

export function briefIsLarge(brief: Pick<Brief, 'tasks'>): boolean {
  return brief.tasks.length > LARGE_BRIEF_TASKS;
}

/**
 * Tasks grouped into Stages: stage N holds the tasks whose longest dependency chain has N-1 edges,
 * so tasks of one stage never depend on each other and a stage only depends on earlier ones.
 * Keys are kept in their Brief order inside a stage. Throws (DagError) on cycles / unknown keys.
 */
export function stagesOf<T extends Pick<BriefTask, 'key' | 'dependsOnKeys'>>(tasks: T[]): T[][] {
  const d = depths(tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys })));
  const stages: T[][] = [];
  for (const t of tasks) {
    const i = d.get(t.key) ?? 0;
    (stages[i] ??= []).push(t);
  }
  return stages.filter(Boolean);
}

/** Name of a task's Area, or null; task-level checks inherit it. */
export function areaOfTask(brief: Pick<Brief, 'areas'>, task: Pick<BriefTask, 'areaKey'>): BriefArea | null {
  return brief.areas.find((a) => a.key === task.areaKey) ?? null;
}

/** kebab-case slug for an Area name (ASCII letters/digits only; falls back to `area-<n>`). */
export function areaSlug(name: string, index = 1): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s || `area-${index}`;
}
