import { z } from 'zod';

/** how an Adjustment is carried out: the finished task's session resumed, a task appended after the finished ones, or the failed tasks restarted with it */
export const AdjustmentMode = z.enum(['resume', 'task', 'restart']);
export type AdjustmentMode = z.infer<typeof AdjustmentMode>;

/**
 * An Adjustment (ADR-0078): the person's words on a finished goal's result — what should change — with the files they
 * gave, carried out by the goal itself (never a new goal). Recorded on the goal in order (`n` from 1); the one a task is
 * carrying out sits on the task until it lands.
 */
export const Adjustment = z.object({
  id: z.string(),
  /** 1-based, in the order the goal's Adjustments were asked for; `artifacts/.history/<n>/` holds the result as it was before this one */
  n: z.number().int().positive(),
  text: z.string().min(1),
  mode: AdjustmentMode,
  /** the task doing it: the finished task resumed, the task appended, or the first failed task restarted */
  taskId: z.string().nullable(),
  /** the goal attachments that came with it (marked `adjustId`) */
  attachmentIds: z.array(z.string()),
  at: z.string(),
  by: z.string().nullable(),
});
export type Adjustment = z.infer<typeof Adjustment>;

/** files on one Adjustment, as on a Conversation question */
export const ADJUST_ATTACHMENTS_MAX = 8;
/** the folder under artifacts/ that keeps the result as it was before each Adjustment: `.history/<n>/` */
export const ARTIFACTS_HISTORY_DIR = '.history';
