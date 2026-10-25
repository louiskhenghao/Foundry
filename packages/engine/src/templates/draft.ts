import type { AgentProvider, CodexEffort, GoalNature, TemplateInput, TemplateLang, TemplateNature } from '@foundry/core';
import { TemplateNature as TemplateNatureSchema, effectiveCodexPresets, inputRequired, jsonSchemaFor, labelOf, natureKey } from '@foundry/core';
import type { RunHandle, RunResult } from '@foundry/runner';
import { buildSettings, readOnlyShellHook } from '@foundry/runner';
import { join } from 'node:path';
import { z } from 'zod';
import { tryJson } from '../checks/reviewer.ts';
import type { Engine } from '../engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS } from '../guards/boundary.ts';
import { modelFor } from '../models/roles.ts';

/**
 * The AI draft of the New goal form (ADR-0079): from the person's rough notes it fills the inputs of the template they
 * chose, or writes a description shaped like the nature's built-in template when they chose none. Fast by default — one
 * turn on the housekeeping model, no tools, the notes alone; with a repository to read, a few read-only turns in that
 * checkout on the Explainer's model, so the words name real files and commands. No goal exists yet: the cost goes to the
 * usage ledger as a `template` session, outside every budget.
 */

export const DRAFT_FAST_BUDGET_USD = 0.1;
export const DRAFT_FAST_TIMEOUT_MS = 90_000;
export const DRAFT_REPO_BUDGET_USD = 1;
export const DRAFT_REPO_TIMEOUT_MS = 3 * 60_000;
export const DRAFT_REPO_MAX_TURNS = 24;
export const DRAFT_NOTES_MAX = 20_000;

export interface TemplateDraftSource {
  name: string;
  body: string;
  inputs: TemplateInput[];
}

export interface TemplateDraftRequest {
  provider: AgentProvider;
  /** what the goal makes; auto = the notes decide */
  nature: GoalNature;
  /** the language the draft is written in */
  lang: TemplateLang;
  notes: string;
  /** the template chosen: its inputs are filled; null = a description is written */
  template: TemplateDraftSource | null;
  /** with no template: the nature's built-in template, the shape the description follows */
  guide: TemplateDraftSource | null;
  /** read this checkout (read-only) so the words fit the code; null = the notes alone */
  repoPath: string | null;
}

export interface TemplateDraftResult {
  /** the template's inputs filled, when a template was chosen */
  values: Record<string, string> | null;
  /** the description written, when none was */
  prompt: string | null;
  /** the kind the notes describe, when the form had not said (nature auto) */
  nature: TemplateNature | null;
  costUsd: number;
  costAvailable: boolean;
  model: string;
  durationMs: number;
}

export class TemplateDraftError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const FillOutput = z.object({ values: z.record(z.string(), z.string()).describe('one entry per input key; an empty string where the notes say nothing about it') });
const WriteOutput = z.object({
  prompt: z.string().describe('the goal description, in Markdown, following the shape given'),
  nature: TemplateNatureSchema.optional().describe('what kind of goal the notes describe, when asked to decide'),
});

const LANGUAGE: Record<TemplateLang, string> = { en: 'English', zh: '中文（简体）' };

/** an input as the model is told of it: key, label, help, kind, options, default, whether it is required */
function describeInput(i: TemplateInput): string {
  const parts = [`${i.key} (${i.label ?? labelOf(i.key)})`];
  if (i.help) parts.push(i.help);
  if (i.type === 'choice' && i.options?.length) parts.push(`one of: ${i.options.join(' | ')}${i.other ? ', or something else if none fits' : ''}`);
  if (i.type === 'textarea') parts.push('may run to a few lines');
  if (i.default !== undefined) parts.push(`default: ${i.default}`);
  parts.push(inputRequired(i) ? 'required' : 'optional');
  return `- ${parts.join(' — ')}`;
}

/** the body with its placeholders as blanks a reader understands: `{{product}}` → `[product]` */
const blanks = (body: string) => body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, '[$1]');

export function draftPrompt(req: TemplateDraftRequest): string {
  const language = LANGUAGE[req.lang];
  const repo = req.repoPath
    ? `\n\n# The repository\nThe goal will run in the repository at ${req.repoPath}, which is your working directory. Read it (read-only) as far as it helps: name the real files, modules, commands and conventions the goal touches, and say nothing about the code you did not check.`
    : '';
  const rules = [
    `Write in ${language}.`,
    'Keep to what the notes say. Never invent a name, a number, a date, a URL or a requirement the notes do not give; where the notes say nothing, leave it empty rather than guess.',
    'Plain words, short sentences, no filler and no praise.',
  ];
  if (req.template) {
    return [
      'You help a person fill in a goal template for Foundry, which turns a goal description into a plan a coding agent carries out.',
      `# The template "${req.template.name}"\n${blanks(req.template.body)}`,
      `# Its inputs\n${req.template.inputs.map(describeInput).join('\n')}`,
      `# The person's notes\n${req.notes.trim()}`,
      `# Your job\nFill each input from the notes${repo ? ' and what the repository shows' : ''}. A one-line value goes into the sentence where its blank is: write it so that sentence reads on (lower case unless it starts with a name, no full stop of its own). For a choice, pick one of its options as written (or write your own only where something else is allowed). An optional input the notes say nothing about stays an empty string. ${rules.join(' ')} Answer with JSON matching the schema: {"values": {<key>: <value>, ...}} with every input key.${repo}`,
    ].join('\n\n');
  }
  const kind = req.nature === 'auto' ? 'Decide first what kind of goal the notes describe — code (software), docs (prose), research (a cited report), image, video, figure (an interactive isometric figure of an object or machine) or cad (3D parts) — and set `nature` to it.' : `This is a ${req.nature} goal.`;
  const shape = req.guide ? `# The shape to follow\nThe description of such a goal, as Foundry's template "${req.guide.name}" shapes it (the brackets are blanks the notes fill; leave out a heading the notes say nothing about, keep the rest in this order):\n\n${blanks(req.guide.body)}` : '# The shape to follow\nA title line, what is wanted, who it is for, how it should behave or look, constraints, how one will know it is done, and what is already decided.';
  return [
    'You help a person describe a goal for Foundry, which turns a goal description into a plan a coding agent carries out. From their notes, write the description the way a senior colleague would want to read it.',
    kind,
    shape,
    `# The person's notes\n${req.notes.trim()}`,
    `# Your job\nWrite the description in Markdown${repo ? ', naming what the repository shows' : ''}. ${rules.join(' ')} Answer with JSON matching the schema: {"prompt": <the description>${req.nature === 'auto' ? ', "nature": <kind>' : ''}}.${repo}`,
  ].join('\n\n');
}

/** the models a draft runs on for this coding agent and kind of goal: the housekeeping model, and the Explainer's row */
export function draftModels(engine: Engine, provider: AgentProvider, nature: GoalNature): { housekeeping: string; explainer: string; effort?: CodexEffort } {
  const { config } = engine;
  if (provider === 'codex') {
    const presets = effectiveCodexPresets(config.codexPresets);
    const key = natureKey(nature);
    const table = (presets[config.codexNaturePreset[key]] ?? Object.values(presets)[0]!).tables[key];
    const name = (m: string) => (m === 'codex-default' ? config.codexModel : m);
    return { housekeeping: name(table.housekeeping.model), explainer: name(table.explainer.model), effort: table.explainer.effort ?? undefined };
  }
  if (provider === 'agy') return { housekeeping: config.agyModel, explainer: config.agyModel };
  return { housekeeping: config.models.cheap, explainer: modelFor(config, { nature, modelPreset: null, provider: 'claude' }, 'explainer').model };
}

/**
 * One session that answers the draft; `onHandle` receives the session as soon as it starts (to stop it). Throws a
 * TemplateDraftError when the model did not answer, or answered in another shape.
 */
export async function runTemplateDraft(engine: Engine, req: TemplateDraftRequest, onHandle?: (h: RunHandle) => void): Promise<TemplateDraftResult> {
  const { config } = engine;
  if (!req.notes.trim()) throw new TemplateDraftError('write a few notes first: what you have in mind, in your own words');
  if (req.notes.length > DRAFT_NOTES_MAX) throw new TemplateDraftError('the notes are longer than a draft needs: keep them under 20,000 characters');
  const repo = req.repoPath;
  const models = draftModels(engine, req.provider, req.nature);
  const model = repo ? models.explainer : models.housekeeping;
  const started = Date.now();
  const stamp = `${started.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const handle = await engine.runner.run({
    prompt: draftPrompt(req),
    cwd: repo ?? config.dataDir,
    model,
    ...(req.provider === 'codex' && models.effort ? { effort: models.effort } : {}),
    meta: { tier: 'template', provider: req.provider },
    maxTurns: repo ? DRAFT_REPO_MAX_TURNS : 1,
    maxBudgetUsd: repo ? DRAFT_REPO_BUDGET_USD : DRAFT_FAST_BUDGET_USD,
    permissionMode: 'dontAsk',
    allowedTools: repo ? READONLY_TOOLS : [],
    ...(repo ? { disallowedTools: READONLY_DISALLOWED, settings: buildSettings([readOnlyShellHook(join(config.hooksDir, 'readonly-bash.ts'))]), settingSources: config.settingSources, readOnlyShell: true, idleTimeoutMs: 60_000 } : {}),
    jsonSchema: jsonSchemaFor(req.template ? FillOutput : WriteOutput),
    timeoutMs: repo ? DRAFT_REPO_TIMEOUT_MS : DRAFT_FAST_TIMEOUT_MS,
    transcriptPath: join(config.dataDir, 'transcripts', `template-draft-${stamp}.jsonl`),
    label: `template draft${req.template ? ` ${req.template.name}` : ''}`,
    lane: 'aside',
  });
  onHandle?.(handle);
  for await (const _ of handle.events) {
    /* the session's events are not shown anywhere: there is no goal page yet */
  }
  const result: RunResult = await handle.result;
  engine.recordSessionUsage(result, { goalId: null, kind: 'template', model, provider: req.provider });
  const costAvailable = req.provider === 'claude' && result.costStatus !== 'unavailable';
  const base = { costUsd: result.costUsd, costAvailable, model, durationMs: Date.now() - started };
  if (result.subtype === 'killed_manual') throw new TemplateDraftError('stopped', 409);
  if (result.subtype !== 'success') throw new TemplateDraftError(`the draft did not finish: ${result.errorMessage ?? result.subtype}`, 502);
  const raw = result.structuredOutput ?? tryJson(result.finalText);
  if (req.template) {
    const parsed = FillOutput.safeParse(raw);
    if (!parsed.success) throw new TemplateDraftError('the AI did not answer with the inputs filled in; try again, or write them yourself', 502);
    const keys = new Set(req.template.inputs.map((i) => i.key));
    const values = Object.fromEntries(Object.entries(parsed.data.values).filter(([k]) => keys.has(k)).map(([k, v]) => [k, v.trim()]));
    return { ...base, values, prompt: null, nature: null };
  }
  const parsed = WriteOutput.safeParse(raw);
  if (!parsed.success || !parsed.data.prompt.trim()) throw new TemplateDraftError('the AI did not answer with a description; try again, or write it yourself', 502);
  return { ...base, values: null, prompt: parsed.data.prompt.trim(), nature: req.nature === 'auto' ? (parsed.data.nature ?? null) : null };
}
