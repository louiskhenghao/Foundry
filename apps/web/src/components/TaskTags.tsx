import { cn } from '../ui.tsx';

/** a task's traits as quiet chips, so its state and the signs carry the colour; only a step done by a goal of its own is violet */
const CHIP = 'inline-block max-w-full truncate whitespace-nowrap rounded-sm border px-1.5 py-px text-[10.5px] leading-tight';
const QUIET = 'border-line-strong/70 font-semibold text-ink-soft';
const KIND = 'border-line-strong/70 bg-inset font-semibold text-ink';
/** kind `goal`: done by a Delegated goal of its own, not by a worker session */
const GOAL_KIND = 'border-extra/40 bg-extra/10 font-semibold text-extra-ink';
const AREA = QUIET;
const SCENARIO = QUIET;

/** Kind / Area / Scenario chips for a task — same look on Brief plan cards and run task cards. */
const DIFFICULTY: Record<string, string> = { complex: 'border-line-strong font-bold text-ink', standard: QUIET, simple: 'border-line font-semibold text-ink-faint' };

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
