import { z } from 'zod';
import type { Goal } from '../schema/goal.ts';
import { BUDGET_PRESETS } from '../schema/goal.ts';
import { TEMPLATE_KEY, TemplateInput, TemplateLang, TemplateNature, TemplateSettings, TemplateVersion, inputRequired, type TemplateVersionView } from '../schema/template.ts';
import { YamlError, parseYaml, yamlText, type YamlValue } from './yaml.ts';

/** `{{key}}`, with spaces allowed inside the braces */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,39})\s*\}\}/g;

/** the keys the body names, in order of first appearance, each once */
export function placeholdersOf(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen];
}

/** a key in words, for a label nobody wrote: `product_name` → "Product name" */
export const labelOf = (key: string): string => {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The body's placeholders are the inputs, in the order the body names them; the frontmatter refines them (label, help,
 * type, options, default, required). An input the frontmatter declares and the body never names is left out, with a
 * warning: the file says something the goal would not use.
 */
export function inputsFor(body: string, declared: TemplateInput[]): { inputs: TemplateInput[]; warnings: string[] } {
  const keys = placeholdersOf(body);
  const byKey = new Map(declared.map((d) => [d.key, d]));
  const inputs = keys.map((key) => byKey.get(key) ?? TemplateInput.parse({ key }));
  const warnings = declared.filter((d) => !keys.includes(d.key)).map((d) => `the input "${d.key}" is declared but the body never names {{${d.key}}}`);
  for (const i of inputs) if (i.type === 'choice' && !i.options?.length) warnings.push(`the choice "${i.key}" offers no options`);
  return { inputs, warnings };
}

/** what a `---` frontmatter block and the text after it are; a file without one is all body */
export function splitFrontmatter(text: string): { head: string | null; body: string } {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { head: null, body: text };
  return { head: m[1]!, body: text.slice(m[0].length) };
}

export type ParsedTemplate = { template: TemplateVersion; warnings: string[] } | { error: string };

/** a schema failure as one line a person can act on: `inputs.1.type: …` */
function issueText(err: z.ZodError): string {
  const i = err.issues[0]!;
  const path = i.path.join('.');
  return `${path ? `${path}: ` : ''}${i.message}`;
}

/**
 * A template file read: its frontmatter (name, summary, nature, settings, inputs) and its body. `lang` is the file's
 * (`.zh.md` or not); a `lang` in the frontmatter must agree. Null and absent read alike, so a hand-written file may
 * leave anything but the name and nature out.
 */
export function parseTemplateText(text: string, lang: TemplateLang): ParsedTemplate {
  if (new TextEncoder().encode(text).length > TEMPLATE_MAX_BYTES) return { error: 'larger than 64 KB, which no template needs' };
  const { head, body } = splitFrontmatter(text);
  if (head === null) return { error: 'a template starts with a frontmatter between two `---` lines: name, nature and what else it says' };
  let data: YamlValue;
  try {
    data = parseYaml(head);
  } catch (e) {
    if (e instanceof YamlError) return { error: `frontmatter ${e.message}` };
    throw e;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { error: 'the frontmatter is `key: value` lines' };
  const fm = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
  if (fm.lang !== undefined && fm.lang !== lang) return { error: `lang: ${String(fm.lang)} does not match the file name (${lang === 'zh' ? '.zh.md is 中文' : '.md is English'})` };
  const declared = z.array(TemplateInput).safeParse(Array.isArray(fm.inputs) ? fm.inputs.map((i) => (i && typeof i === 'object' && !Array.isArray(i) ? Object.fromEntries(Object.entries(i).filter(([, v]) => v !== null)) : i)) : fm.inputs === undefined ? [] : fm.inputs);
  if (!declared.success) return { error: `inputs: ${issueText(declared.error)}` };
  const trimmed = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!trimmed.trim()) return { error: 'the body (after the frontmatter) is the goal description: it cannot be empty' };
  const { inputs, warnings } = inputsFor(trimmed, declared.data);
  const parsed = TemplateVersion.safeParse({ lang, name: fm.name, summary: fm.summary ?? '', nature: fm.nature, settings: stripNulls(fm.settings) ?? {}, inputs, body: trimmed });
  if (!parsed.success) return { error: issueText(parsed.error) };
  return { template: parsed.data, warnings };
}

function stripNulls(v: YamlValue | undefined): YamlValue | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripNulls(x)]).filter(([, x]) => x !== undefined)) as YamlValue;
  return v;
}

export const TEMPLATE_MAX_BYTES = 64 * 1024;

/**
 * The file a template is written as: the frontmatter in the order a reader expects (name, summary, nature, settings,
 * inputs), then the body. Inputs that only repeat what the body implies (a text input with no label, help, default or
 * options) are left out of the frontmatter: the placeholder says it.
 */
export function templateFileText(t: TemplateVersion): string {
  const inputs = t.inputs
    .filter((i) => i.label !== undefined || i.help !== undefined || i.type !== 'text' || i.options !== undefined || i.other || i.default !== undefined || i.required !== undefined)
    .map((i) => {
      const o: Record<string, YamlValue> = { key: i.key };
      if (i.label !== undefined) o.label = i.label;
      if (i.help !== undefined) o.help = i.help;
      if (i.type !== 'text') o.type = i.type;
      if (i.options !== undefined) o.options = i.options;
      if (i.other) o.other = true;
      if (i.default !== undefined) o.default = i.default;
      if (i.required !== undefined) o.required = i.required;
      return o;
    });
  const fm: Record<string, YamlValue> = { name: t.name };
  if (t.summary) fm.summary = t.summary;
  fm.nature = t.nature;
  if (t.lang !== 'en') fm.lang = t.lang;
  const settings = settingsYaml(t.settings);
  if (Object.keys(settings).length) fm.settings = settings;
  if (inputs.length) fm.inputs = inputs;
  return `---\n${yamlText(fm)}---\n\n${t.body.replace(/\s+$/, '')}\n`;
}

/** the settings as the frontmatter writes them: nothing that is unset */
function settingsYaml(s: TemplateSettings): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  if (s.videoPack) out.videoPack = s.videoPack;
  if (s.figurePack) out.figurePack = s.figurePack;
  if (s.mode) out.mode = s.mode;
  if (s.workflow && Object.values(s.workflow).some((v) => v !== undefined)) out.workflow = Object.fromEntries(Object.entries(s.workflow).filter(([, v]) => v !== undefined)) as Record<string, YamlValue>;
  if (s.budgetPreset) out.budgetPreset = s.budgetPreset;
  if (s.budgets && Object.values(s.budgets).some((v) => v !== undefined)) out.budgets = Object.fromEntries(Object.entries(s.budgets).filter(([, v]) => v !== undefined)) as Record<string, YamlValue>;
  if (s.interviewDepth !== undefined) out.interviewDepth = s.interviewDepth;
  if (s.autoBrief) out.autoBrief = { mustChecks: s.autoBrief.mustChecks, ...(s.autoBrief.stretchChecks?.length ? { stretchChecks: s.autoBrief.stretchChecks } : {}) };
  return out;
}

/** the value an input has: what was given, else its default, else nothing */
const valueOf = (i: TemplateInput, values: Record<string, string>): string => (values[i.key]?.trim() ? values[i.key]!.trim() : (i.default ?? ''));

/**
 * The description a template makes of the values: every placeholder replaced by its input's value (or default); an
 * optional input left empty leaves nothing behind. `missing` names the required inputs still empty — a goal is not made
 * while there are any.
 */
export function renderTemplate(t: Pick<TemplateVersion, 'body' | 'inputs'>, values: Record<string, string>): { prompt: string; missing: string[] } {
  const byKey = new Map(t.inputs.map((i) => [i.key, i]));
  const missing = t.inputs.filter((i) => inputRequired(i) && !valueOf(i, values)).map((i) => i.key);
  const heading = (s: string) => /^#{1,6}\s/.test(s);
  const rendered = t.body.split('\n').map((line) => {
    let placeholders = 0;
    let filled = 0;
    const out = line
      .replace(PLACEHOLDER, (_, key: string) => {
        placeholders++;
        const v = byKey.has(key) ? valueOf(byKey.get(key)!, values) : '';
        if (v) filled++;
        return v;
      })
      .replace(/[^\S\n]+$/, '');
    // a line that held nothing but empty placeholders and their label goes: no "Audience:" is left hanging
    return { out, drop: placeholders > 0 && !filled && /^\s*(?:[-*]\s+)?(?:[^{}]*[:：])?\s*$/.test(out) };
  });
  const kept = rendered.filter((r, i) => {
    if (r.drop) return false;
    if (!heading(r.out)) return true;
    // a heading whose whole section went with its empty inputs goes too; one that never had a section stays
    const section: typeof rendered = [];
    for (let j = i + 1; j < rendered.length && !heading(rendered[j]!.out); j++) if (rendered[j]!.drop || rendered[j]!.out.trim()) section.push(rendered[j]!);
    return !(section.length > 0 && section.every((s) => s.drop));
  });
  const prompt = kept
    .map((r) => r.out)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { prompt, missing };
}

/** the settings a goal was made with, as a template would carry them: what the New goal form shows of its work */
export function settingsFromGoal(g: Pick<Goal, 'videoPack' | 'figurePack' | 'mode' | 'workflow' | 'budgetPreset' | 'budgets' | 'interview' | 'nature'>): TemplateSettings {
  const s: TemplateSettings = { mode: g.mode, workflow: { pace: g.workflow.pace, tdd: g.workflow.tdd, ponytail: g.workflow.ponytail, ...(g.workflow.profile ? { profile: g.workflow.profile } : {}) }, budgetPreset: g.budgetPreset, interviewDepth: g.interview?.depth ?? 0 };
  if (g.nature === 'video' && g.videoPack) s.videoPack = g.videoPack;
  if (g.nature === 'figure' && g.figurePack) s.figurePack = g.figurePack;
  if (g.budgetPreset === 'custom') {
    const { attemptTimeoutMin: _t, ...limits } = g.budgets;
    const d = BUDGET_PRESETS.custom.budgets;
    if (JSON.stringify(limits) !== JSON.stringify({ maxCostUsd: d.maxCostUsd, maxDurationMin: d.maxDurationMin, maxConcurrent: d.maxConcurrent, attemptsPerTask: d.attemptsPerTask })) s.budgets = limits;
  }
  return s;
}

/**
 * A template to start from a goal (Save as template): its description as the body, in plain words — the person marks
 * what should become an input by writing `{{a_key}}` over it — and the settings the goal was made with.
 */
export function templateFromGoal(g: Pick<Goal, 'title' | 'prompt' | 'nature' | 'videoPack' | 'figurePack' | 'mode' | 'workflow' | 'budgetPreset' | 'budgets' | 'interview'>, lang: TemplateLang = 'en'): TemplateVersion {
  const nature = TemplateNature.safeParse(g.nature);
  return { lang, name: g.title.slice(0, 80), summary: '', nature: nature.success ? nature.data : 'code', settings: settingsFromGoal(g), inputs: inputsFor(g.prompt, []).inputs, body: g.prompt.trim() };
}

/** a template as the API lists one version of it */
export const versionView = (t: TemplateVersion, file: string | null, warnings: string[]): TemplateVersionView => ({ ...t, file, warnings });
