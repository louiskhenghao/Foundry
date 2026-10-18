import { cn } from '../ui.tsx';

const CHIP = 'inline-block max-w-full truncate text-[10px] rounded-full border px-1.5 py-0.5';
const KIND = 'border-violet-500/40 bg-violet-500/10 text-violet-300';
/** kind `goal`: done by a Delegated goal of its own, not by a worker session */
const GOAL_KIND = 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200';
const AREA = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
const SCENARIO = 'border-sky-500/40 bg-sky-500/10 text-sky-300';

/** Kind / Area / Scenario chips for a task — same look on Brief plan cards and run task cards. */
const DIFFICULTY: Record<string, string> = { complex: 'border-amber-500/40 bg-amber-500/10 text-amber-300', standard: 'border-blue-500/40 bg-blue-500/10 text-blue-300', simple: 'border-zinc-600 bg-zinc-800/60 text-zinc-400' };

export function TaskTags({ kind, scenario, area, difficulty, className }: { kind: string; scenario: string; area?: string | null; difficulty?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
      <span className={cn(CHIP, kind === 'goal' ? GOAL_KIND : KIND)} title={kind === 'goal' ? 'Kind goal — a delegated goal of its own does this step (its own Clarify, plan and tasks); its result lands here as this task\'s commit' : 'Kind — the workflow discipline the worker follows'}>{kind === 'goal' ? 'delegated goal' : kind}</span>
      {area && <span className={cn(CHIP, AREA)} title="Area — the part of the plan this task belongs to">{area}</span>}
      <span className={cn(CHIP, SCENARIO)} title="Scenario — where the work happens (selects scenario skills)">{scenario}</span>
      {difficulty && DIFFICULTY[difficulty] && <span className={cn(CHIP, DIFFICULTY[difficulty])} title="Difficulty — picks the preset row (Simple / Standard / Complex tasks) the worker runs on">{difficulty}</span>}
    </span>
  );
}
