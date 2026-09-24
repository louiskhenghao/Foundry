import { z } from 'zod';

/** The actions whose model a preset sets, in the order the Settings table shows them. */
export const MODEL_ACTIONS = ['clarifier', 'planner', 'simple', 'standard', 'complex', 'merger', 'goalReviewer', 'taskReviewer', 'documenter', 'feedback', 'suggest', 'styleSample'] as const;
export type ModelAction = (typeof MODEL_ACTIONS)[number];

export const ACTION_INFO: Record<ModelAction, { label: string; help: string }> = {
  clarifier: { label: 'Clarify', help: 'Explores the repository, interviews you and writes the Brief; Draft / Revise resume its session.' },
  planner: { label: 'Planner', help: 'The sub-agent inside Clarify that splits each Area into the task DAG.' },
  simple: { label: 'Simple tasks', help: 'Config, copy edits, scaffolding from a template, one small component.' },
  standard: { label: 'Standard tasks', help: 'Typical feature work — most tasks.' },
  complex: { label: 'Complex tasks', help: 'Cross-cutting changes, architecture, data migrations, concurrency, large refactors. The last attempt of any task (budget ≥ 2) and every retry you grant also run here.' },
  merger: { label: 'Merge attempts', help: 'Resolves merge conflicts when tasks or the base branch collide.' },
  goalReviewer: { label: 'Goal reviewer', help: 'Reads the whole goal diff at the end against the acceptance checks — the most expensive single session. Goals under the small-goal size (Reviews) use the Task reviewer model instead.' },
  taskReviewer: { label: 'Task reviewer', help: 'Reads each task diff against its checks before it lands.' },
  documenter: { label: 'Documenter', help: 'Writes the completion docs you chose at approval.' },
  feedback: { label: 'Feedback triage', help: 'Turns what you write at a milestone into a hint, fix tasks or a Decision.' },
  suggest: { label: 'Suggest a hint', help: 'The AI diagnosis and hint for a blocked task in the Inbox.' },
  styleSample: { label: 'Style samples', help: 'The one-image samples of a style direction on the Brief page.' },
};

/** Goal natures group into three tables: code (and unclassified), prose (docs, research), media (image, video). */
export const MODEL_NATURES = ['code', 'docs', 'media'] as const;
export type ModelNature = (typeof MODEL_NATURES)[number];
export const NATURE_LABEL: Record<ModelNature, string> = { code: 'Code', docs: 'Docs & research', media: 'Media' };
export function natureKey(nature: string): ModelNature {
  return nature === 'docs' || nature === 'research' ? 'docs' : nature === 'image' || nature === 'video' ? 'media' : 'code';
}
/** rows a nature seldom runs — shown greyed, still editable */
export const RARELY_USED: Record<ModelNature, ModelAction[]> = { code: [], docs: ['styleSample', 'merger'], media: ['merger', 'documenter'] };

export const PresetTable = z.object(Object.fromEntries(MODEL_ACTIONS.map((a) => [a, z.string().min(1)])) as Record<ModelAction, z.ZodString>);
export type PresetTable = z.infer<typeof PresetTable>;
export const ModelPreset = z.object({
  label: z.string().min(1),
  description: z.string().default(''),
  tables: z.object({ code: PresetTable, docs: PresetTable, media: PresetTable }),
  /** built-in presets you edited: the shipped version the edit started from, to tell you when a newer default exists */
  basedOn: z.string().nullable().default(null),
});
export type ModelPreset = z.infer<typeof ModelPreset>;

const t = (clarifier: string, planner: string, simple: string, standard: string, complex: string, merger: string, goalReviewer: string, taskReviewer: string, documenter: string, feedback: string, suggest: string, styleSample: string): PresetTable => ({ clarifier, planner, simple, standard, complex, merger, goalReviewer, taskReviewer, documenter, feedback, suggest, styleSample });
const all = (m: string) => t(m, m, m, m, m, m, m, m, m, m, m, m);

/** Shipped presets. Values are aliases so they follow new model releases. */
export const BUILTIN_PRESETS: Record<string, ModelPreset> = {
  max: { label: 'Max', description: 'The most capable model everywhere — best code and output, highest cost.', basedOn: null, tables: { code: all('fable'), docs: all('fable'), media: all('fable') } },
  production: {
    label: 'Production',
    description: 'Fable where judgement matters (planning, hard tasks, the final review), Opus for the bulk of the work.',
    basedOn: null,
    tables: {
      //          clarify  planner  simple    standard complex  merger    goalRev  taskRev   docs      feedback  suggest  style
      code: t('fable', 'fable', 'sonnet', 'opus', 'fable', 'opus', 'fable', 'sonnet', 'opus', 'sonnet', 'opus', 'opus'),
      docs: t('fable', 'opus', 'sonnet', 'opus', 'fable', 'sonnet', 'fable', 'sonnet', 'opus', 'sonnet', 'opus', 'opus'),
      media: t('fable', 'opus', 'sonnet', 'sonnet', 'opus', 'sonnet', 'fable', 'opus', 'sonnet', 'sonnet', 'opus', 'opus'),
    },
  },
  balanced: {
    label: 'Balanced',
    description: 'Opus for planning and hard tasks, Sonnet for most work and reviews, Haiku for small checks.',
    basedOn: null,
    tables: {
      code: t('opus', 'opus', 'sonnet', 'sonnet', 'opus', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'haiku', 'sonnet', 'sonnet'),
      docs: t('opus', 'sonnet', 'sonnet', 'opus', 'opus', 'sonnet', 'opus', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet'),
      media: t('opus', 'sonnet', 'sonnet', 'sonnet', 'opus', 'sonnet', 'opus', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet'),
    },
  },
  economy: {
    label: 'Economy',
    description: 'Sonnet for planning and most work, Haiku for simple tasks and small checks — lowest cost.',
    basedOn: null,
    tables: {
      code: t('sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'haiku', 'sonnet', 'sonnet'),
      docs: t('sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet'),
      media: t('sonnet', 'sonnet', 'haiku', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'sonnet', 'haiku', 'haiku', 'sonnet', 'sonnet'),
    },
  },
};
export const BUILTIN_PRESET_IDS = Object.keys(BUILTIN_PRESETS);
export const DEFAULT_NATURE_PRESETS: Record<ModelNature, string> = { code: 'production', docs: 'balanced', media: 'balanced' };

/** a stable fingerprint of a preset's tables, to tell an edited built-in that the shipped one has since changed */
export function presetFingerprint(p: Pick<ModelPreset, 'tables'>): string {
  return MODEL_NATURES.map((n) => MODEL_ACTIONS.map((a) => p.tables[n][a]).join(',')).join('|');
}

/** the presets in effect: shipped ones, overridden or joined by the ones saved in Settings */
export function effectivePresets(saved: Record<string, ModelPreset>): Record<string, ModelPreset> {
  return { ...BUILTIN_PRESETS, ...saved };
}

/** a saved built-in the user edited: differs from the shipped one; `newerDefault` = the shipped one changed since the edit */
export function builtinStatus(id: string, saved: Record<string, ModelPreset>): { builtin: boolean; modified: boolean; newerDefault: boolean } {
  const shipped = BUILTIN_PRESETS[id];
  const own = saved[id];
  if (!shipped) return { builtin: false, modified: false, newerDefault: false };
  if (!own) return { builtin: true, modified: false, newerDefault: false };
  const modified = presetFingerprint(own) !== presetFingerprint(shipped);
  return { builtin: true, modified, newerDefault: modified && own.basedOn != null && own.basedOn !== presetFingerprint(shipped) };
}
