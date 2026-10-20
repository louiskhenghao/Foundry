import type { Attachment, GoalRecipe, ScheduleCadence } from '@foundry/core/browser';

/** what the New goal form sends to make a goal, as far as a schedule keeps it */
export type GoalBody = Partial<GoalRecipe> & { prompt: string; repoPath: string; attachments?: Attachment[]; references?: unknown; issue?: unknown; follows?: unknown };

/** The recipe a schedule keeps from what the form would submit: links stay, uploads, references, an issue and a follow-up do not. */
export function recipeFromBody(body: GoalBody): GoalRecipe {
  const { attachments, references: _r, issue: _i, follows: _f, ...rest } = body;
  const links = (attachments ?? []).filter((a) => a.kind === 'link' && a.url).map((a) => ({ url: a.url!, name: a.name, note: a.note ?? undefined }));
  return { ...rest, links } as GoalRecipe;
}

/** a schedule's name to start from: the title, else the first line of the description, cut short */
export function scheduleNameFrom(title: string, prompt: string): string {
  const line = (title.trim() || prompt.trim().split('\n')[0] || 'Scheduled goal').trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

/** tomorrow at three in the morning, the quiet hours */
export const defaultCadence = (): ScheduleCadence => ({ kind: 'daily', at: '03:00' });

/** the names the time inputs use for a cadence's parts */
export const WEEKDAY_OPTIONS = [
  { id: 1, label: 'Monday' },
  { id: 2, label: 'Tuesday' },
  { id: 3, label: 'Wednesday' },
  { id: 4, label: 'Thursday' },
  { id: 5, label: 'Friday' },
  { id: 6, label: 'Saturday' },
  { id: 0, label: 'Sunday' },
] as const;
