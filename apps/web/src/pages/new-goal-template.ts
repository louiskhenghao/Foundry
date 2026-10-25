import type { Budgets, BudgetPreset, TemplateEntry, TemplateLang, TemplateNature, TemplateVersionView } from '@foundry/core/browser';
import { BUDGET_PRESETS, inputRequired, labelOf, renderTemplate } from '@foundry/core/browser';
import type { PackGroupView } from '../api.ts';

/** the language the templates are shown in, for this browser (ADR-0079): English unless the person switched */
export const TEMPLATE_LANG_KEY = 'foundry.templateLang';
export function loadTemplateLang(): TemplateLang {
  try {
    return localStorage.getItem(TEMPLATE_LANG_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}
export function saveTemplateLang(lang: TemplateLang): void {
  try {
    localStorage.setItem(TEMPLATE_LANG_KEY, lang);
  } catch {}
}

/** the version of a template in the language chosen, else the one it has */
export const shownVersion = (t: TemplateEntry, lang: TemplateLang): TemplateVersionView => t[lang] ?? t.en ?? t.zh!;

/** the kinds of goal, in the order the form lists them */
export const TEMPLATE_NATURES: TemplateNature[] = ['code', 'docs', 'research', 'image', 'video', 'figure', 'cad'];

/** what the form shows of the templates: the figure ones and the motion-studio ones only while their Beta is on */
export function offeredTemplates(all: TemplateEntry[], beta: { figure: boolean; motionStudio: boolean }): TemplateEntry[] {
  return all.filter((t) => (t.nature !== 'figure' || beta.figure) && (!t.settings.videoPack || beta.motionStudio));
}

/** the templates of each kind, kinds with none left out */
export function byNature(ts: TemplateEntry[]): { nature: TemplateNature; templates: TemplateEntry[] }[] {
  return TEMPLATE_NATURES.map((nature) => ({ nature, templates: ts.filter((t) => t.nature === nature) })).filter((g) => g.templates.length);
}

/** does a template answer a search: its name, summary or body in the shown language, or its id */
export function matchesSearch(t: TemplateEntry, lang: TemplateLang, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const v = shownVersion(t, lang);
  return [t.id, v.name, v.summary, v.body, ...v.inputs.map((i) => i.label ?? labelOf(i.key))].some((s) => s.toLowerCase().includes(needle));
}

/** a template's inputs as they start: their defaults, else empty */
export const initialValues = (v: Pick<TemplateVersionView, 'inputs'>): Record<string, string> => Object.fromEntries(v.inputs.map((i) => [i.key, i.default ?? '']));

/** the inputs still to fill before the goal can be made, by label */
export const missingLabels = (v: Pick<TemplateVersionView, 'inputs' | 'body'>, values: Record<string, string>): string[] =>
  renderTemplate(v, values).missing.map((k) => {
    const i = v.inputs.find((x) => x.key === k);
    return i?.label ?? labelOf(k);
  });

/**
 * What a template sets on the New goal form (ADR-0079): only what its settings say; the rest of the form stays as the
 * person left it. A video engine or figure style is dropped while its Beta is off (the form could not show it).
 */
export interface TemplateFormPatch {
  nature: TemplateNature;
  videoPack?: string;
  figurePack?: 'colorfigures' | 'iso-glow';
  mode?: 'simple' | 'expert';
  pace?: 'thorough' | 'fast';
  tdd?: 'required' | 'preferred' | 'off';
  ponytail?: 'on' | 'off';
  profile?: 'mattpocock' | 'pstack' | 'plain';
  budget?: { preset: BudgetPreset; budgets: Budgets };
  interviewDepth?: string;
  /** skip Clarify with these checks */
  auto?: { checks: string; stretch: string };
  /** what the template asked for that this form cannot take now */
  dropped: string[];
}
export function formPatch(t: TemplateEntry, beta: { figure: boolean; motionStudio: boolean }): TemplateFormPatch {
  const s = t.settings;
  const patch: TemplateFormPatch = { nature: t.nature, dropped: [] };
  if (s.videoPack) {
    if (beta.motionStudio) patch.videoPack = s.videoPack;
    else patch.dropped.push(`its video engine (${s.videoPack}): the motion-studio Beta is off`);
  }
  if (s.figurePack && s.figurePack !== 'none') {
    if (beta.figure) patch.figurePack = s.figurePack;
    else patch.dropped.push(`its figure style (${s.figurePack}): the figure Beta is off`);
  }
  if (s.mode) patch.mode = s.mode;
  if (s.workflow?.pace) patch.pace = s.workflow.pace;
  if (s.workflow?.tdd) patch.tdd = s.workflow.tdd;
  if (s.workflow?.ponytail) patch.ponytail = s.workflow.ponytail;
  if (s.workflow?.profile) patch.profile = s.workflow.profile;
  if (s.budgetPreset) patch.budget = { preset: s.budgetPreset, budgets: { ...BUDGET_PRESETS[s.budgetPreset].budgets, ...(s.budgetPreset === 'custom' ? (s.budgets ?? {}) : {}) } as Budgets };
  if (s.interviewDepth !== undefined) patch.interviewDepth = String(s.interviewDepth);
  if (s.autoBrief) patch.auto = { checks: s.autoBrief.mustChecks.join('\n'), stretch: (s.autoBrief.stretchChecks ?? []).join('\n') };
  return patch;
}

/** the figure style the form holds when it is not installed for the coding agent, by its label (a template can choose one the
 * form's own buttons could not); null while the install state is not known, or when it is installed */
export function missingStyle(packs: PackGroupView | null, id: string): string | null {
  const option = packs?.options.find((o) => o.id === id);
  if (!option) return null;
  return option.entries.length > 0 && option.entries.every((e) => e.status.startsWith('installed')) ? null : option.label;
}
/** the style a figure goal falls back to, as the engine picks it (figureStyleOf): Settings' pack when it is installed, else the
 * first installed style; null when none is installed (the worker draws by hand) */
export function fallbackStyle(packs: PackGroupView | null): string | null {
  const styles = (packs?.options ?? []).filter((o) => o.id === 'colorfigures' || o.id === 'iso-glow');
  const installed = styles.filter((o) => missingStyle(packs, o.id) === null);
  return (installed.find((o) => o.id === packs?.chosen) ?? installed[0])?.label ?? null;
}

/** the kinds in words, as the form names them */
export const NATURE_WORD: Record<TemplateNature, string> = { code: 'Code', docs: 'Documents', research: 'Research', image: 'Images', video: 'Video', figure: 'Figures', cad: 'CAD' };

/** is every required input of a template answered */
export const complete = (v: Pick<TemplateVersionView, 'inputs'>, values: Record<string, string>): boolean => v.inputs.every((i) => !inputRequired(i) || !!(values[i.key]?.trim() || i.default));
