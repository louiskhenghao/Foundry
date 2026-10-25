import { AgentProvider, GoalNature, TemplateLang, TemplateVersion, newId, renderTemplate, type TemplateEntry, type TemplateNature, type TemplateVersionView } from '@foundry/core';
import type { CreateGoalInput, TemplateDraftResult, Engine, OpenTargetId, Person } from '@foundry/engine';
import { DRAFT_NOTES_MAX, TemplateDraftError, OpenError, assertAllowed, defaultAllowedRoots, inspectRepo, openFile, openPath, runTemplateDraft } from '@foundry/engine';
import type { RunHandle } from '@foundry/runner';
import type { Hono } from 'hono';
import { z } from 'zod';
import { HttpError } from './http-error.ts';
import { copyTemplate, deleteTemplate, freeId, importTemplate, listTemplates, prepareTemplatesDir, renameTemplate, templateText, templatesDir, writeTemplate } from './templates.ts';

type App = Hono<{ Variables: { person: Person | null } }>;

/** what a request names of a Template: which one, in which language, and (the CLI) the values to render it with */
export const TemplateRefBody = z.object({
  id: z.string().min(1),
  lang: TemplateLang.optional(),
  values: z.record(z.string(), z.string()).optional(),
});
export type TemplateRefBody = z.infer<typeof TemplateRefBody>;

/** the templates as the folders hold them now */
export const templatesOf = (engine: Engine) => listTemplates(engine.config.templatesDir, templatesDir(engine.config.dataDir));

/** a template by id, or 404 */
function templateOr404(engine: Engine, id: string): TemplateEntry {
  const t = templatesOf(engine).templates.find((x) => x.id === id);
  if (!t) throw new HttpError(404, { error: `no template ${id}` });
  return t;
}

/** the version asked for, else the one the template has */
export function versionOf(t: TemplateEntry, lang?: TemplateLang): TemplateVersionView {
  return (lang ? t[lang] : null) ?? t.en ?? t.zh!;
}

/** the built-in template a description of each kind is shaped like when the person chose none */
export const GUIDE_TEMPLATE: Record<TemplateNature, string> = { code: 'code-feature', docs: 'docs-prd', research: 'research-report', image: 'image-poster', video: 'video-product-reel', figure: 'figure-how-it-works', cad: 'cad-part' };

/** a draft under way, done, failed or stopped; forgotten a while after it ends */
interface DraftJob {
  id: string;
  startedAt: number;
  status: 'running' | 'done' | 'failed' | 'stopped';
  result: TemplateDraftResult | null;
  error: string | null;
  handle: RunHandle | null;
  stopAsked: boolean;
}
const DRAFT_KEEP_MS = 10 * 60_000;

/**
 * What POST /api/goals makes of a goal from a Template (ADR-0079): the description rendered from the values when only
 * those came (the CLI; the form renders as the person types and sends the words), the template's settings about the
 * work for every field the request left unsaid, and the template recorded on the goal. A required input left empty
 * refuses the goal and names it.
 */
export function goalFromTemplate<B extends { prompt?: string; template?: TemplateRefBody; nature?: unknown }>(engine: Engine, body: B): Omit<B, 'template' | 'prompt'> & { prompt: string; template: CreateGoalInput['template'] } {
  const { template: ref, prompt, ...rest } = body;
  if (!ref) {
    if (!prompt?.trim()) throw new HttpError(400, { error: 'prompt is required' });
    return { ...rest, prompt, template: null };
  }
  const t = templateOr404(engine, ref.id);
  const v = versionOf(t, ref.lang);
  let words = prompt;
  if (words === undefined) {
    const r = renderTemplate(v, ref.values ?? {});
    if (r.missing.length) throw new HttpError(400, { error: `the template needs ${r.missing.map((k) => `--set ${k}=…`).join(' ')}`, missing: r.missing });
    words = r.prompt;
  }
  const s = v.settings;
  const given = rest as Record<string, unknown>;
  const defaults: Record<string, unknown> = { nature: t.nature };
  if (s.videoPack && engine.config.betaMotionStudio) defaults.videoPack = s.videoPack;
  if (s.figurePack && engine.config.betaFigure) defaults.figurePack = s.figurePack;
  if (s.mode) defaults.mode = s.mode;
  if (s.workflow) defaults.workflow = s.workflow;
  if (s.budgetPreset) defaults.budgetPreset = s.budgetPreset;
  if (s.budgets) defaults.budgets = s.budgets;
  if (s.interviewDepth !== undefined) defaults.interviewDepth = s.interviewDepth;
  if (s.autoBrief) defaults.autoBrief = s.autoBrief;
  for (const [k, val] of Object.entries(defaults)) if (given[k] === undefined) given[k] = val;
  return { ...(given as Omit<B, 'template' | 'prompt'>), prompt: words, template: { id: t.id, name: v.name } };
}

/** the Templates API (ADR-0079): the built-in ones and the files in the data folder's templates/ */
export function registerTemplateRoutes(app: App, engine: Engine): void {
  const dir = () => templatesDir(engine.config.dataDir);
  const builtInIds = () => new Set(templatesOf(engine).templates.filter((t) => t.builtIn).map((t) => t.id));
  const entry = (id: string) => templateOr404(engine, id);
  /** a template of the person's own, by id: a built-in one has no file to change */
  const own = (id: string) => {
    const t = templatesOf(engine).templates.find((x) => x.id === id && !x.builtIn);
    if (!t) throw new HttpError(404, { error: `no template of your own called ${id}` });
    return t;
  };

  app.get('/api/templates', (c) => c.json(templatesOf(engine)));

  // a template of the person's own: a copy of one to edit (`from`), or a new one from what the editor says
  app.post('/api/templates', async (c) => {
    const body = z.object({ from: z.string().min(1).optional(), name: z.string().max(80).optional(), template: TemplateVersion.optional() }).parse(await c.req.json());
    if (body.from) {
      const id = copyTemplate(dir(), builtInIds(), entry(body.from), body.name);
      return c.json(entry(id), 201);
    }
    if (!body.template) throw new HttpError(400, { error: 'name a template to copy (from), or give the template to write' });
    const id = freeId(dir(), builtInIds(), body.template.name);
    writeTemplate(dir(), id, body.template);
    return c.json(entry(id), 201);
  });

  // one language of a template of the person's own, as the editor saved it (its file is written whole)
  app.put('/api/templates/:id', async (c) => {
    const t = own(c.req.param('id'));
    const body = TemplateVersion.parse(await c.req.json());
    writeTemplate(dir(), t.id, body);
    return c.json(entry(t.id));
  });

  // renamed (its files follow the name), deleted, or its file to keep or pass on
  app.patch('/api/templates/:id', async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json());
    return c.json(entry(renameTemplate(dir(), builtInIds(), own(c.req.param('id')), name)));
  });
  app.delete('/api/templates/:id', (c) => {
    deleteTemplate(own(c.req.param('id')));
    return c.json({ ok: true });
  });
  app.get('/api/templates/:id/file', (c) => {
    const t = entry(c.req.param('id'));
    const lang = TemplateLang.safeParse(c.req.query('lang'));
    const v = (lang.success ? t[lang.data] : null) ?? t.en ?? t.zh!;
    return c.body(templateText(v), 200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${t.id}${v.lang === 'zh' ? '.zh' : ''}.md"` });
  });

  // a template file from elsewhere, checked as the folder's own files are
  app.post('/api/templates/import', async (c) => {
    const body = z.object({ file: z.string().max(200), text: z.string() }).parse(await c.req.json());
    const made = importTemplate(dir(), builtInIds(), body.file, body.text);
    if ('error' in made) throw new HttpError(400, { error: made.error });
    return c.json({ ...entry(made.id), lang: made.lang }, 201);
  });

  // the description a template makes of these values, and what is still missing: the form's preview, the CLI's check
  app.post('/api/templates/render', async (c) => {
    const body = TemplateRefBody.parse(await c.req.json());
    const t = entry(body.id);
    const v = versionOf(t, body.lang);
    return c.json({ ...renderTemplate(v, body.values ?? {}), name: v.name, nature: t.nature, settings: t.settings });
  });

  // ---- the AI draft (ADR-0079): fills the chosen template's inputs from rough notes, or writes a description ----
  const drafts = new Map<string, DraftJob>();
  const sweepDrafts = (now = Date.now()) => {
    for (const [id, j] of drafts) if (j.status !== 'running' && now - j.startedAt > DRAFT_KEEP_MS) drafts.delete(id);
  };
  const draftOr404 = (id: string) => {
    const j = drafts.get(id);
    if (!j) throw new HttpError(404, { error: 'this draft is gone; ask for another' });
    return j;
  };
  app.post('/api/templates/draft', async (c) => {
    const body = z
      .object({
        provider: AgentProvider.optional(),
        nature: GoalNature.optional(),
        lang: TemplateLang.optional(),
        notes: z.string().max(DRAFT_NOTES_MAX),
        template: z.object({ id: z.string().min(1), lang: TemplateLang.optional() }).optional(),
        /** read this checkout too (the form's repository, once it passed its check) */
        repoPath: z.string().min(1).optional(),
      })
      .parse(await c.req.json());
    if (!body.notes.trim()) throw new HttpError(400, { error: 'write a few notes first: what you have in mind, in your own words' });
    const provider = body.provider ?? engine.config.provider;
    const lang = body.lang ?? 'en';
    const chosen = body.template ? versionOf(entry(body.template.id), body.template.lang ?? lang) : null;
    const nature: GoalNature = chosen?.nature ?? body.nature ?? 'auto';
    const guideId = nature !== 'auto' ? GUIDE_TEMPLATE[nature as TemplateNature] : null;
    const guideEntry = !chosen && guideId ? templatesOf(engine).templates.find((t) => t.id === guideId) : null;
    const guide = guideEntry ? versionOf(guideEntry, lang) : null;
    let repoPath: string | null = null;
    if (body.repoPath) {
      // the checkout the goal will run in: inside the folders Foundry may touch, a repository with commits
      try {
        repoPath = assertAllowed(body.repoPath, engine.config.allowedRoots ?? defaultAllowedRoots());
      } catch (e) {
        throw new HttpError(403, { error: String((e as Error).message ?? e) });
      }
      const info = await inspectRepo(repoPath);
      if (!info.isGitRepo || !info.hasCommits) throw new HttpError(400, { error: 'the repository has to pass its check before the draft can read it' });
    }
    sweepDrafts();
    const job: DraftJob = { id: newId('td'), startedAt: Date.now(), status: 'running', result: null, error: null, handle: null, stopAsked: false };
    drafts.set(job.id, job);
    void runTemplateDraft(engine, { provider, nature, lang, notes: body.notes, template: chosen ? { name: chosen.name, body: chosen.body, inputs: chosen.inputs } : null, guide: guide ? { name: guide.name, body: guide.body, inputs: guide.inputs } : null, repoPath }, (h) => {
      job.handle = h;
      if (job.stopAsked) h.kill('killed_manual');
    })
      .then((r) => {
        job.status = job.stopAsked ? 'stopped' : 'done';
        job.result = r;
      })
      .catch((e: unknown) => {
        job.status = job.stopAsked || (e instanceof TemplateDraftError && e.status === 409) ? 'stopped' : 'failed';
        job.error = String((e as Error).message ?? e);
      });
    return c.json({ id: job.id, status: job.status }, 202);
  });
  app.get('/api/templates/draft/:id', (c) => {
    const j = draftOr404(c.req.param('id'));
    return c.json({ id: j.id, status: j.status, result: j.result, error: j.error, elapsedMs: Date.now() - j.startedAt });
  });
  app.delete('/api/templates/draft/:id', (c) => {
    const j = draftOr404(c.req.param('id'));
    if (j.status === 'running') {
      j.stopAsked = true;
      j.handle?.kill('killed_manual');
    }
    return c.json({ id: j.id, status: j.status === 'running' ? 'stopped' : j.status });
  });

  // the templates folder, or with `template` one file of the person's own (in an editor only); never another path
  app.post('/api/templates/open', async (c) => {
    const { target, template, lang } = z.object({ target: z.string(), template: z.string().optional(), lang: TemplateLang.optional() }).parse(await c.req.json());
    const folder = prepareTemplatesDir(dir());
    const file = template ? versionOf(own(template), lang).file : undefined;
    if (template && !file) throw new HttpError(404, { error: `no file for ${template}` });
    const path = file ?? folder;
    try {
      return c.json({ ok: true, path, command: (await (file ? openFile(target as OpenTargetId, file) : openPath(target as OpenTargetId, folder))).command });
    } catch (e) {
      if (e instanceof OpenError) throw new HttpError(e.code === 'unknown-target' ? 404 : 400, { error: e.message, code: e.code, path });
      throw e;
    }
  });
}
