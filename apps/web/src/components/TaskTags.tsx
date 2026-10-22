import { CODES, cn } from '../ui.tsx';

/**
 * A task's traits as small chips, each kind of trait in a category colour (ADR-0067), the hues they had before themes:
 * its kind violet (magenta for a step done by a goal of its own), its Area in the Area's own colour where the Brief is at
 * hand, its size orange when complex and blue when standard. The scenario stays quiet, and none is a signal: the task's
 * state says how it stands.
 */
const CHIP = 'inline-block max-w-full truncate whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-semibold leading-tight';
const QUIET = 'ring-1 ring-inset ring-line-strong/70 text-ink-soft';
const KIND = CODES[2].chip;
/** kind `goal`: done by a Delegated goal of its own, not by a worker session */
const GOAL_KIND = CODES[6].chip;
const SCENARIO = QUIET;

/** Kind / Area / Scenario chips for a task — same look on Brief plan cards and run task cards. */
const DIFFICULTY: Record<string, string> = { complex: CODES[3].chip, standard: CODES[0].chip, simple: 'ring-1 ring-inset ring-line text-ink-faint' };

export function TaskTags({ kind, scenario, area, areaChip, difficulty, className }: { kind: string; scenario: string; area?: string | null; /** the Area's chip from the Brief (areaStyle); without one the Area's chip is quiet */ areaChip?: string; difficulty?: string | null; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
      <span className={cn(CHIP, kind === 'goal' ? GOAL_KIND : KIND)} title={kind === 'goal' ? 'Kind goal — a delegated goal of its own does this step (its own Clarify, plan and tasks); its result lands here as this task\'s commit' : 'Kind — the workflow discipline the worker follows'}>{kind === 'goal' ? 'delegated goal' : kind}</span>
      {area &&
        (areaChip ? (
          // the Brief's own chip for the Area, its name cut short when the card is narrow
          <span className={cn(areaChip, 'max-w-full')} title="Area — the part of the plan this task belongs to">
            <span className="truncate">{area}</span>
          </span>
        ) : (
          <span className={cn(CHIP, QUIET)} title="Area — the part of the plan this task belongs to">{area}</span>
        ))}
      <span className={cn(CHIP, SCENARIO)} title="Scenario — where the work happens (selects scenario skills)">{scenario}</span>
      {difficulty && DIFFICULTY[difficulty] && <span className={cn(CHIP, DIFFICULTY[difficulty])} title="Difficulty — picks the preset row (Simple / Standard / Complex tasks) the worker runs on">{difficulty}</span>}
    </span>
  );
}
