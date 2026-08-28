import type { Brief, BriefArea, BriefCheck, BriefTask } from '@foundry/core/browser';
import { areaSlug } from '@foundry/core/browser';

export const TASK_KINDS = ['feature', 'bug', 'refactor', 'research', 'chore'] as const;

/** Stable colour per Area (by position), for chips and DAG dots. Literal classes so Tailwind keeps them. */
const PALETTE = [
  { chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: '#34d399' },
  { chip: 'border-sky-500/40 bg-sky-500/10 text-sky-300', dot: '#38bdf8' },
  { chip: 'border-violet-500/40 bg-violet-500/10 text-violet-300', dot: '#a78bfa' },
  { chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300', dot: '#fbbf24' },
  { chip: 'border-rose-500/40 bg-rose-500/10 text-rose-300', dot: '#fb7185' },
  { chip: 'border-teal-500/40 bg-teal-500/10 text-teal-300', dot: '#2dd4bf' },
  { chip: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300', dot: '#e879f9' },
  { chip: 'border-lime-500/40 bg-lime-500/10 text-lime-300', dot: '#a3e635' },
];
export const UNASSIGNED_STYLE = { chip: 'border-zinc-700 bg-zinc-800/60 text-zinc-400', dot: '#71717a' };

export function areaStyle(brief: Pick<Brief, 'areas'>, key: string | null): { chip: string; dot: string } {
  const i = brief.areas.findIndex((a) => a.key === key);
  return i < 0 ? UNASSIGNED_STYLE : PALETTE[i % PALETTE.length]!;
}

export function areaOf(brief: Pick<Brief, 'areas'>, key: string | null): BriefArea | null {
  return brief.areas.find((a) => a.key === key) ?? null;
}

/** T<n> / C<n> / A<n> continuing after the highest existing number. */
export function nextKey(prefix: 'T' | 'C' | 'A', keys: string[]): string {
  const max = keys.reduce((m, k) => (k.startsWith(prefix) && /^\d+$/.test(k.slice(1)) ? Math.max(m, Number(k.slice(1))) : m), 0);
  return `${prefix}${max + 1}`;
}

export function newTask(brief: Brief, areaKey: string | null = null): BriefTask {
  return { key: nextKey('T', brief.tasks.map((t) => t.key)), title: '', spec: '', kind: 'feature', scope: null, scenario: 'general', areaKey: areaKey ?? (brief.areas.length === 1 ? brief.areas[0]!.key : null), tdd: 'inherit', dependsOnKeys: [], parallelizable: true, relevantFiles: [] };
}

export function newArea(brief: Brief, name = ''): BriefArea {
  const key = nextKey('A', brief.areas.map((a) => a.key));
  return { key, name, slug: areaSlug(name, brief.areas.length + 1), description: '' };
}

export function newCheck(brief: Brief, type: 'command' | 'reviewer', taskKey: string | null, areaKey: string | null = null): BriefCheck {
  const key = nextKey('C', brief.checks.map((c) => c.key));
  return { key, name: '', tier: 'must', taskKey, areaKey: taskKey ? null : areaKey, spec: type === 'command' ? { type: 'command', cmd: '', timeoutMs: 300_000, expectExitCode: 0 } : { type: 'reviewer', scope: taskKey ? 'task-diff' : 'goal-diff', rubric: '' } };
}

/** Switch a check between Command and Reviewer, keeping what carries over (name → rubric). */
export function convertCheck(check: BriefCheck, type: 'command' | 'reviewer'): BriefCheck {
  if (check.spec.type === type) return check;
  return { ...check, spec: type === 'command' ? { type: 'command', cmd: '', timeoutMs: 300_000, expectExitCode: 0 } : { type: 'reviewer', scope: check.taskKey ? 'task-diff' : 'goal-diff', rubric: check.spec.type === 'command' ? check.name : '' } };
}

/** Re-home a check: task-level ↔ goal-level (reviewer scope follows). */
export function assignCheck(check: BriefCheck, taskKey: string | null, areaKey: string | null = null): BriefCheck {
  const spec = check.spec.type === 'reviewer' ? { ...check.spec, scope: taskKey ? ('task-diff' as const) : ('goal-diff' as const) } : check.spec;
  return { ...check, taskKey, areaKey: taskKey ? null : areaKey, spec };
}

/** A check the engine would reject on approval. */
export function checkProblem(c: BriefCheck): string | null {
  if (!c.name.trim()) return 'needs a name';
  if (c.spec.type === 'command' && !c.spec.cmd.trim()) return 'command is empty';
  if (c.spec.type === 'reviewer' && !c.spec.rubric.trim()) return 'rubric is empty';
  return null;
}

export function taskProblem(t: BriefTask): string | null {
  if (!t.title.trim()) return 'needs a title';
  return null;
}

export const fmtCost = (n: number) => `$${n.toFixed(2)}`;
