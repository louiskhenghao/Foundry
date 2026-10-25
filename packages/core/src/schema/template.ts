import { z } from 'zod';
import { BudgetPreset, Budgets, FigurePack, GoalMode, GoalWorkflow } from './goal.ts';
import { VideoPack } from './packs.ts';

/**
 * A Template (ADR-0079): a pattern the New goal form starts from — a description with `{{placeholders}}` that become
 * inputs, and the settings about the work (never about this computer or its accounts) the form takes with it. Foundry
 * ships a set in `templates/` of its own checkout, in English and 中文 (`<id>.md` and `<id>.zh.md`); the person's own
 * are files of the same shape in `templates/` of the data folder.
 */

/** a template's id: its file name without `.md` / `.zh.md` — lowercase letters, digits and hyphens, at most 40 */
export const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const TemplateLang = z.enum(['en', 'zh']);
export type TemplateLang = z.infer<typeof TemplateLang>;
export const TEMPLATE_LANGS: TemplateLang[] = ['en', 'zh'];

/** what a template makes: every nature but auto — a template always knows */
export const TemplateNature = z.enum(['code', 'docs', 'research', 'image', 'video', 'figure', 'cad']);
export type TemplateNature = z.infer<typeof TemplateNature>;

export const TemplateInputType = z.enum(['text', 'textarea', 'choice']);
export type TemplateInputType = z.infer<typeof TemplateInputType>;

/** a placeholder's key, as written between the braces: `{{product_name}}` */
export const TEMPLATE_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/** what the frontmatter may say about one input; everything but the key is optional (the body's placeholder is the input) */
export const TemplateInput = z.object({
  key: z.string().regex(TEMPLATE_KEY, 'a key is letters, digits, _ or -, starting with a letter'),
  /** shown over the field; default: the key in words */
  label: z.string().trim().min(1).max(80).optional(),
  help: z.string().trim().max(500).optional(),
  type: TemplateInputType.default('text'),
  /** choice: the options offered */
  options: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
  /** choice: the person may type something else */
  other: z.boolean().default(false),
  default: z.string().max(2000).optional(),
  /** must be filled before the goal is made; default: yes, unless a default is given */
  required: z.boolean().optional(),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

/** is this input one the goal cannot be made without */
export const inputRequired = (i: Pick<TemplateInput, 'required' | 'default'>): boolean => i.required ?? i.default === undefined;

/**
 * The New goal form settings a template may carry: those about the work. Not the coding agent, its models or effort,
 * the delivery, the output folder, the repository, its companions, attachments, references or issue — they belong to
 * a computer and its accounts, and a template travels.
 */
export const TemplateSettings = z.object({
  /** a video goal's engine (ADR-0077); the form drops it while the motion-studio Beta is off */
  videoPack: VideoPack.optional(),
  /** a figure goal's style (ADR-0076); the form drops it while the figure Beta is off */
  figurePack: FigurePack.optional(),
  mode: GoalMode.optional(),
  workflow: GoalWorkflow.partial().optional(),
  budgetPreset: BudgetPreset.optional(),
  /** with budgetPreset custom: the limits */
  budgets: Budgets.partial().optional(),
  interviewDepth: z.number().int().min(0).max(5).optional(),
  /** skip Clarify: one task with these command checks */
  autoBrief: z.object({ mustChecks: z.array(z.string().min(1)), stretchChecks: z.array(z.string().min(1)).optional() }).optional(),
});
export type TemplateSettings = z.infer<typeof TemplateSettings>;

/** what a template file says, once read: its frontmatter and its body */
export const TemplateVersion = z.object({
  lang: TemplateLang,
  name: z.string().trim().min(1).max(80),
  /** one line under the name in the gallery */
  summary: z.string().trim().max(300).default(''),
  nature: TemplateNature,
  settings: TemplateSettings.default({}),
  /** the inputs in the order the body first names them, each as the frontmatter refined it */
  inputs: z.array(TemplateInput),
  /** the description with its `{{placeholders}}` */
  body: z.string(),
});
export type TemplateVersion = z.infer<typeof TemplateVersion>;

/** a version as the API lists it: where its file is (null for a built-in one) and what the frontmatter said that the body ignores */
export interface TemplateVersionView extends TemplateVersion {
  file: string | null;
  warnings: string[];
}

/** A template Foundry knows: built in, or the person's own; in English, 中文 or both */
export interface TemplateEntry {
  id: string;
  builtIn: boolean;
  nature: TemplateNature;
  settings: TemplateSettings;
  en: TemplateVersionView | null;
  zh: TemplateVersionView | null;
}

/** a template file that cannot be used, and why */
export interface TemplateProblem {
  file: string;
  error: string;
}
