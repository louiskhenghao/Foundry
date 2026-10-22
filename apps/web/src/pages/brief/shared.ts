import type { Brief, BriefArea, BriefCheck, BriefTask } from '@foundry/core/browser';
import { areaSlug } from '@foundry/core/browser';
import { BookOpenText, Eye, Flag, Gavel, Image, LayoutGrid, Lightbulb, ListChecks, type LucideIcon, MessageCircleQuestion, Play, ScanSearch, ShieldCheck, Wallet } from 'lucide-react';
import { code } from '../../ui.tsx';

/** a section's category colour (ADR-0067): its icon's ink, the dot before it in the side list, the edge of its group */
const hue = (i: number) => {
  const c = code(i);
  return { ink: c.ink, dot: c.dot, bar: c.bar };
};

/**
 * The parts of the Brief page, each with its icon and a category colour of its own, so the page reads at a glance: the
 * hues the sections had before themes (understanding blue, decisions green, acceptance red…), in the theme's colours.
 */
export type BriefSection = 'understanding' | 'questions' | 'subjects' | 'assumptions' | 'decisions' | 'opinion' | 'areas' | 'plan' | 'acceptance' | 'reference' | 'run' | 'completion' | 'budget';
export const SECTION_STYLE: Record<BriefSection, { Icon: LucideIcon; ink: string; dot: string; bar: string }> = {
  understanding: { Icon: BookOpenText, ...hue(0) },
  questions: { Icon: MessageCircleQuestion, ...hue(3) },
  subjects: { Icon: Image, ...hue(6) },
  assumptions: { Icon: Lightbulb, ...hue(2) },
  decisions: { Icon: Gavel, ...hue(1) },
  opinion: { Icon: Eye, ...hue(5) },
  areas: { Icon: LayoutGrid, ...hue(7) },
  plan: { Icon: ListChecks, ...hue(0) },
  acceptance: { Icon: ShieldCheck, ...hue(4) },
  reference: { Icon: ScanSearch, ...hue(5) },
  run: { Icon: Play, ...hue(0) },
  completion: { Icon: Flag, ...hue(2) },
  budget: { Icon: Wallet, ...hue(1) },
};
/** the section a Brief page nav item (id "brief-<section>") belongs to */
export const sectionOfNav = (id: string): BriefSection | null => (id.startsWith('brief-') && id.slice(6) in SECTION_STYLE ? (id.slice(6) as BriefSection) : null);

/**
 * The plan arrived while the page held edits of the Brief skeleton: the tasks, their checks and the estimate come in
 * from the planned Brief, everything else stays as edited; questions the plan added (an Area without tasks) are appended.
 */
export function withPlan(local: Brief, planned: Brief): Brief {
  return {
    ...local,
    tasks: planned.tasks,
    checks: [...local.checks.filter((c) => c.taskKey === null), ...planned.checks.filter((c) => c.taskKey !== null)],
    costEstimateUsd: planned.costEstimateUsd,
    timeEstimateMin: planned.timeEstimateMin,
    questions: [...local.questions, ...planned.questions.filter((q) => !local.questions.some((l) => l.id === q.id))],
  };
}

/** every kind a task may have; `goal` = a Delegated goal of its own does the step (the planner offers it only where the goal allows delegation) */
export const TASK_KINDS = ['feature', 'bug', 'refactor', 'research', 'chore', 'goal'] as const;

/** an Area's tag shape: a small chip, tinted in the Area's colour */
const AREA_CHIP = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10.5px] font-semibold leading-tight';
/** each Area's category colour, by its place in the Brief: green, blue, violet, then on round the eight, as before themes */
const AREA_CODES = [1, 0, 2, 3, 4, 5, 6, 7];
export const UNASSIGNED_STYLE = { chip: `${AREA_CHIP} ring-1 ring-inset ring-line text-ink-faint`, dot: 'var(--color-line-strong)' };

/** An Area's chip and its dot (a CSS colour, for DAG nodes and lists): a category colour of its own, never a signal. */
export function areaStyle(brief: Pick<Brief, 'areas'>, key: string | null): { chip: string; dot: string } {
  const i = brief.areas.findIndex((a) => a.key === key);
  if (i < 0) return UNASSIGNED_STYLE;
  const c = code(AREA_CODES[i % AREA_CODES.length]!);
  return { chip: `${AREA_CHIP} ${c.chip}`, dot: c.css };
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
  return { key: nextKey('T', brief.tasks.map((t) => t.key)), title: '', spec: '', kind: 'feature', scope: null, scenario: 'general', areaKey: areaKey ?? (brief.areas.length === 1 ? brief.areas[0]!.key : null), tdd: 'inherit', dependsOnKeys: [], parallelizable: true, relevantFiles: [], milestone: null };
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
