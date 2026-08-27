import { cn } from '../ui.tsx';

const CHIP = 'inline-block max-w-full truncate text-[10px] rounded-full border px-1.5 py-0.5';
const KIND = 'border-violet-500/40 bg-violet-500/10 text-violet-300';
const AREA = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
const SCENARIO = 'border-sky-500/40 bg-sky-500/10 text-sky-300';

/** Kind / Area / Scenario chips for a task — same look on Brief plan cards and run task cards. */
export function TaskTags({ kind, scenario, area, className }: { kind: string; scenario: string; area?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
      <span className={cn(CHIP, KIND)} title="Kind — the workflow discipline the worker follows">{kind}</span>
      {area && <span className={cn(CHIP, AREA)} title="Area — the part of the plan this task belongs to">{area}</span>}
      <span className={cn(CHIP, SCENARIO)} title="Scenario — where the work happens (selects scenario skills)">{scenario}</span>
    </span>
  );
}
