/**
 * Schedules (ADR-0054): a saved goal recipe that fires on a cadence. The engine looks every minute for schedules that
 * are due, makes one goal per firing with the recipe, and skips a firing while the previous run is still going. A
 * schedule that says so has its runs' Briefs approved by the engine, the interview skipped, so a run needs nobody
 * at the keyboard; otherwise the Brief waits for the person like any goal's.
 */
import type { Goal, GoalRecipe, Schedule, ScheduleCadence } from '@foundry/core';
import { IdPrefix, calibratedEstimate, getBrief, getGoal, getSchedule, isDue, listSchedules, newId, nextRunAt, proposeBudgetFromEstimate, Schedule as ScheduleSchema } from '@foundry/core';
import { calibrationFor } from './calibration.ts';
import { linkAttachment } from './attachments.ts';
import type { Engine } from './engine.ts';
import { subjectSearchesFor } from './subjects.ts';

export class ScheduleError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** a run is over when its goal is: done, over-delivered, failed or cancelled */
const OVER = new Set<Goal['state']>(['done', 'over_delivered', 'failed', 'cancelled']);
/** a firing this long past its time counts as late (the engine was off or asleep) */
const LATE_MS = 60 * 60_000;

/** the previous run of a schedule, when its goal still exists */
export function previousRun(engine: Engine, s: Schedule): Goal | null {
  return s.lastRun?.goalId ? getGoal(engine.store.db, s.lastRun.goalId) : null;
}

/** What the person saves from the New goal form: the recipe, the cadence, the name, the switches. */
export interface ScheduleInput {
  id?: string;
  name: string;
  cadence: ScheduleCadence;
  recipe: GoalRecipe;
  autoApprove?: boolean;
  enabled?: boolean;
}

/** Make or change a Schedule. The whole schedule is saved; its cadence counts from now. */
export function saveSchedule(engine: Engine, input: ScheduleInput): Schedule {
  const now = new Date().toISOString();
  const existing = input.id ? getSchedule(engine.store.db, input.id) : null;
  if (input.id && !existing) throw new ScheduleError(`schedule ${input.id} not found`, 404);
  if (!input.recipe.repoPath.startsWith('/')) throw new ScheduleError('the recipe needs an absolute repository folder', 400);
  const schedule = ScheduleSchema.parse({
    id: existing?.id ?? newId(IdPrefix.schedule),
    name: input.name.trim(),
    enabled: input.enabled ?? existing?.enabled ?? true,
    cadence: input.cadence,
    recipe: input.recipe,
    autoApprove: input.autoApprove ?? existing?.autoApprove ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRun: existing?.lastRun ?? null,
    runs: existing?.runs ?? 0,
  });
  engine.store.append({ type: 'schedule.set', goalId: null, payload: { schedule } });
  return schedule;
}

/** Enable or disable a Schedule; enabling counts the cadence from now (no catch-up of the time it was off). */
export function setScheduleEnabled(engine: Engine, id: string, enabled: boolean): Schedule {
  const s = getSchedule(engine.store.db, id);
  if (!s) throw new ScheduleError(`schedule ${id} not found`, 404);
  if (s.enabled === enabled) return s;
  const next = { ...s, enabled, updatedAt: new Date().toISOString() };
  engine.store.append({ type: 'schedule.set', goalId: null, payload: { schedule: next } });
  return next;
}

export function deleteSchedule(engine: Engine, id: string): void {
  const s = getSchedule(engine.store.db, id);
  if (!s) throw new ScheduleError(`schedule ${id} not found`, 404);
  engine.store.append({ type: 'schedule.deleted', goalId: null, payload: { scheduleId: id, name: s.name } });
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Fire a Schedule: one goal from its recipe, titled after the schedule and the day. While the previous run is still
 * going, nothing is made: the firing is recorded as skipped (a manual run refuses instead). A recipe that cannot make
 * a goal (a folder gone, say) is recorded as skipped with the reason.
 */
export async function fireSchedule(engine: Engine, s: Schedule, opts: { manual?: boolean; now?: Date } = {}): Promise<{ goalId: string | null; skipped: string | null }> {
  const now = opts.now ?? new Date();
  const prev = previousRun(engine, s);
  const due = nextRunAt(s, now);
  const late = !opts.manual && !!due && now.getTime() - due.getTime() > LATE_MS;
  const record = (goalId: string | null, skipped: string | null) => {
    engine.store.append({ type: 'schedule.fired', goalId, payload: { scheduleId: s.id, name: s.name, at: now.toISOString(), skipped, late, manual: !!opts.manual } });
    return { goalId, skipped };
  };
  if (prev && !OVER.has(prev.state)) {
    const why = `the previous run is still going: "${prev.title}" is ${prev.state.replace(/_/g, ' ')}`;
    if (opts.manual) throw new ScheduleError(why, 409);
    return record(null, why);
  }
  const r = s.recipe;
  try {
    const attachments = r.links.map((l) => engine.stage(linkAttachment(l.url, { name: l.name, note: l.note })));
    const goal = await engine.createGoal({
      provider: r.provider,
      codexModel: r.codexModel,
      prompt: r.prompt,
      repoPath: r.repoPath,
      title: `${r.title?.trim() || s.name} · ${day(now)}`,
      baseBranch: r.baseBranch,
      budgets: r.budgets,
      budgetPreset: r.budgetPreset,
      modelPreset: r.modelPreset,
      effort: r.effort,
      nature: r.nature,
      mode: r.mode,
      workflow: r.workflow,
      delivery: r.delivery,
      delegation: r.delegation,
      // a run nobody attends has no one to answer an interview: the Clarifier writes the Brief on what it finds
      interviewDepth: s.autoApprove ? 0 : r.interviewDepth,
      autoBrief: r.autoBrief,
      selfCheck: r.selfCheck,
      milestonePause: s.autoApprove ? false : r.milestonePause,
      outputDir: r.outputDir,
      attachments,
      schedule: { id: s.id, name: s.name, at: now.toISOString(), autoApprove: s.autoApprove },
    });
    return record(goal.id, null);
  } catch (err) {
    return record(null, `no goal could be made: ${String((err as Error).message ?? err)}`);
  }
}

/** One pass: every enabled schedule that is due fires. Runs every minute, and once at start (a missed run fires once). */
export async function checkSchedules(engine: Engine, now = new Date()): Promise<void> {
  for (const s of listSchedules(engine.store.db)) {
    if (!isDue(s, now)) continue;
    try {
      await fireSchedule(engine, s, { now });
    } catch (err) {
      engine.config.log(`[schedules] ${s.id} (${s.name}) could not fire: ${String((err as Error).message ?? err)}`);
    }
  }
}

/**
 * A scheduled goal whose schedule approves for the person is approved by the engine once its Brief is in, with the
 * budget the Brief proposes when the preset is Auto, unless a blocking question is left (then the Brief waits for the
 * person and Brief ready is sent). Like a Delegated goal's auto-approval.
 */
export function autoApproveScheduled(engine: Engine, goal: Goal): void {
  const { store } = engine;
  if (!goal.schedule?.autoApprove || goal.state !== 'awaiting_brief_approval') return;
  if (engine.investigating.has(goal.id) || engine.approvingDelegated.has(goal.id) || subjectSearchesFor(goal.id).length) return;
  const brief = getBrief(store.db, goal.id)?.brief;
  if (!brief || brief.questions.some((q) => q.blocking && !q.answer?.trim())) return;
  // the estimate as earlier goals corrected it (ADR-0056): a run nobody watches gets a budget that fits
  const budgets = goal.budgetPreset === 'auto' ? proposeBudgetFromEstimate(calibratedEstimate(brief, calibrationFor(engine, goal))) : undefined;
  engine.approvingDelegated.set(
    goal.id,
    engine
      .approveBrief(goal.id, undefined, budgets)
      .then(() => void store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `Brief approved by the engine: the schedule "${goal.schedule!.name}" approves its runs itself${budgets ? ` (budget from the estimate: $${budgets.maxCostUsd} / ${budgets.maxDurationMin} min)` : ''}` } }))
      .catch((err) => void (engine.isStopped || store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the Brief could not be approved by the engine (${String((err as Error)?.message ?? err)}); approve it yourself` } })))
      .finally(() => engine.approvingDelegated.delete(goal.id)),
  );
}

/** a goal the engine approves for the person: a Delegated goal on auto-approve, or a scheduled run that says so */
export const engineApproves = (goal: Goal): boolean => (!!goal.delegatedFrom && goal.delegation.autoApprove) || !!goal.schedule?.autoApprove;
