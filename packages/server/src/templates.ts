import { TEMPLATE_ID, TEMPLATE_LANGS, TEMPLATE_MAX_BYTES, parseTemplateText, templateFileText, versionView, type TemplateEntry, type TemplateLang, type TemplateProblem, type TemplateVersion, type TemplateVersionView } from '@foundry/core';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Templates (ADR-0079): the built-in ones are `templates/<id>.md` (English) and `templates/<id>.zh.md` (中文) in
 * Foundry's own checkout; the person's own are files of the same shape in `templates/` of the data folder. A file is
 * read every time it is asked for, so an edit in any editor shows at once.
 */
export const templatesDir = (dataDir: string) => join(dataDir, 'templates');

/** `<id>.md` or `<id>.zh.md`, else null */
export function templateFileName(file: string): { id: string; lang: TemplateLang } | null {
  const m = /^([^/]+?)(\.zh)?\.md$/.exec(file);
  if (!m) return null;
  return { id: m[1]!, lang: m[2] ? 'zh' : 'en' };
}
export const fileOf = (id: string, lang: TemplateLang) => `${id}${lang === 'zh' ? '.zh' : ''}.md`;

/** the template files of a folder, read; a file that cannot be used says why */
function readFolder(dir: string, builtIn: boolean, taken: (id: string) => boolean): { entries: Map<string, TemplateEntry>; problems: TemplateProblem[] } {
  const entries = new Map<string, TemplateEntry>();
  const problems: TemplateProblem[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort((a, b) => a.localeCompare(b)) : [];
  for (const file of files) {
    const named = templateFileName(file);
    if (!named) continue;
    const path = join(dir, file);
    if (!TEMPLATE_ID.test(named.id)) {
      problems.push({ file, error: 'rename the file: lowercase letters, digits and hyphens (at most 40), then .md or .zh.md' });
      continue;
    }
    if (taken(named.id)) {
      problems.push({ file, error: `${named.id} is the name of a built-in template: rename the file` });
      continue;
    }
    if (statSync(path).size > TEMPLATE_MAX_BYTES) {
      problems.push({ file, error: 'larger than 64 KB, which no template needs' });
      continue;
    }
    const r = parseTemplateText(readFileSync(path, 'utf8'), named.lang);
    if ('error' in r) {
      problems.push({ file, error: r.error });
      continue;
    }
    const view = versionView(r.template, path, r.warnings);
    const entry = entries.get(named.id) ?? { id: named.id, builtIn, nature: r.template.nature, settings: r.template.settings, en: null, zh: null };
    entry[named.lang] = view;
    entries.set(named.id, entry);
  }
  // the entry speaks for its English version where there is one; a twin that disagrees on the nature is a problem
  for (const e of entries.values()) {
    const lead = e.en ?? e.zh!;
    e.nature = lead.nature;
    e.settings = lead.settings;
    if (e.en && e.zh && e.en.nature !== e.zh.nature) problems.push({ file: fileOf(e.id, 'zh'), error: `its nature (${e.zh.nature}) differs from ${fileOf(e.id, 'en')} (${e.en.nature}): the two are one template in two languages` });
  }
  return { entries, problems };
}

/** The built-in templates, then the person's own, each in the languages its files give; the files that cannot be used, with why */
export function listTemplates(builtInDir: string, dir: string): { builtInDir: string; dir: string; templates: TemplateEntry[]; problems: TemplateProblem[] } {
  const shipped = readFolder(builtInDir, true, () => false);
  const own = readFolder(dir, false, (id) => shipped.entries.has(id));
  const byId = (a: TemplateEntry, b: TemplateEntry) => a.id.localeCompare(b.id);
  return { builtInDir, dir, templates: [...[...shipped.entries.values()].sort(byId), ...[...own.entries.values()].sort(byId)], problems: [...own.problems, ...shipped.problems.map((p) => ({ ...p, file: join(builtInDir, p.file) }))] };
}

/** the templates folder of the data folder, made if missing */
export function prepareTemplatesDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** the id for a template called `name`: its words in lowercase joined by hyphens, never a built-in one or a file there (`keep`, the template's own, may stay) */
export function freeId(dir: string, builtIn: Set<string>, name: string, keep?: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'my-template';
  const taken = (id: string) => id !== keep && (builtIn.has(id) || TEMPLATE_LANGS.some((l) => existsSync(join(dir, fileOf(id, l)))));
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/** one language's file of a template of the person's own, written; the entry as the folder then lists it */
export function writeTemplate(dir: string, id: string, t: TemplateVersion): string {
  prepareTemplatesDir(dir);
  const file = join(dir, fileOf(id, t.lang));
  writeFileSync(file, templateFileText(t));
  return file;
}

/** A copy of a template to edit, under `name` (default: "<its name> copy"), in every language it has */
export function copyTemplate(dir: string, builtIn: Set<string>, from: TemplateEntry, name?: string): string {
  const lead = from.en ?? from.zh!;
  const title = (name?.trim() || `${lead.name} copy`).slice(0, 80);
  const id = freeId(dir, builtIn, title);
  for (const lang of TEMPLATE_LANGS) {
    const v = from[lang];
    if (v) writeTemplate(dir, id, { ...stripView(v), name: title });
  }
  return id;
}

const stripView = (v: TemplateVersionView): TemplateVersion => {
  const { file: _f, warnings: _w, ...t } = v;
  return t;
};

/** A template of the person's own under a new name, in every language it has; its files follow the name */
export function renameTemplate(dir: string, builtIn: Set<string>, entry: TemplateEntry, name: string): string {
  const title = name.trim().slice(0, 80);
  const id = freeId(dir, builtIn, title, entry.id);
  for (const lang of TEMPLATE_LANGS) {
    const v = entry[lang];
    if (!v?.file) continue;
    writeTemplate(dir, id, { ...stripView(v), name: title });
    if (id !== entry.id) rmSync(v.file);
  }
  return id;
}

/** A template of the person's own, gone: its files are removed */
export function deleteTemplate(entry: TemplateEntry): void {
  for (const lang of TEMPLATE_LANGS) if (entry[lang]?.file) rmSync(entry[lang]!.file!);
}

/** a template's file as written, to save elsewhere */
export const templateText = (v: TemplateVersionView): string => (v.file ? readFileSync(v.file, 'utf8') : templateFileText(v));

/**
 * A template file from elsewhere (its name and its text), checked as the folder's own files are, then written under its
 * file's name where that is free (else with a number); a `.zh.md` joins the template of that id when it is the person's
 * own and has no 中文 yet, else it starts a template of its own.
 */
export function importTemplate(dir: string, builtIn: Set<string>, fileName: string, text: string): { id: string; lang: TemplateLang } | { error: string } {
  const named = templateFileName(fileName.replace(/^.*[\\/]/, '')) ?? { id: fileName.replace(/\.md$/i, ''), lang: 'en' as TemplateLang };
  const r = parseTemplateText(text, named.lang);
  if ('error' in r) return { error: r.error };
  prepareTemplatesDir(dir);
  const base = TEMPLATE_ID.test(named.id) ? named.id : freeId(dir, builtIn, named.id || r.template.name);
  // the other language of a template already here joins it; the same language again gets a number
  const joins = !builtIn.has(base) && !existsSync(join(dir, fileOf(base, named.lang))) && TEMPLATE_LANGS.some((l) => existsSync(join(dir, fileOf(base, l))));
  const id = joins ? base : freeId(dir, builtIn, base);
  writeTemplate(dir, id, r.template);
  return { id, lang: named.lang };
}
