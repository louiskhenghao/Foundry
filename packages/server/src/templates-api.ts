import { TemplateLang, TemplateVersion, renderTemplate, type TemplateEntry, type TemplateVersionView } from '@foundry/core';
import type { CreateGoalInput, Engine, OpenTargetId, Person } from '@foundry/engine';
import { OpenError, openFile, openPath } from '@foundry/engine';
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
