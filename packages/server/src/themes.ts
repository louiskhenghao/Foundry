import { BUILTIN_THEMES, THEME_ID, parseTheme, themeJsonSchema, type ThemeEntry, type ThemeProblem } from '@foundry/core';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Custom themes (ADR-0066): one JSON file each in `themes/` of the data folder, its name the theme's id. */
export const themesDir = (dataDir: string) => join(dataDir, 'themes');

/** written next to the themes so an editor can check a theme file and explain its settings; never a theme itself */
const SCHEMA_FILE = 'theme.schema.json';
const MAX_BYTES = 64 * 1024;

/** The built-in themes, then every readable theme file; a file that cannot be used says why, so it can be fixed. */
export function listThemes(dir: string): { dir: string; themes: ThemeEntry[]; problems: ThemeProblem[] } {
  const themes: ThemeEntry[] = [...BUILTIN_THEMES];
  const problems: ThemeProblem[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && f !== SCHEMA_FILE).sort((a, b) => a.slice(0, -5).localeCompare(b.slice(0, -5))) : [];
  for (const file of files) {
    const id = file.slice(0, -'.json'.length);
    const path = join(dir, file);
    if (!THEME_ID.test(id)) problems.push({ file, error: 'rename the file: lowercase letters, digits and hyphens (at most 40), then .json' });
    else if (BUILTIN_THEMES.some((b) => b.id === id)) problems.push({ file, error: `${id} is the name of a built-in theme: rename the file` });
    else if (statSync(path).size > MAX_BYTES) problems.push({ file, error: 'larger than 64 KB, which no theme needs' });
    else {
      const r = parseTheme(readFileSync(path, 'utf8'));
      if ('error' in r) problems.push({ file, error: r.error });
      else themes.push({ id, theme: r.theme, builtIn: false, file: path });
    }
  }
  return { dir, themes, problems };
}

/** the themes folder, made if missing, with the schema editors read */
export function prepareThemesDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SCHEMA_FILE), `${JSON.stringify(themeJsonSchema(), null, 2)}\n`);
  return dir;
}

/**
 * A copy of `from` to edit, under `name` (default: "<its name> copy"): `themes/<id>.json`, the id made from the name and
 * never one that is taken. The file names the schema, so an editor checks it while it is edited.
 */
export function copyTheme(dir: string, from: ThemeEntry, name?: string): ThemeEntry {
  prepareThemesDir(dir);
  const title = (name?.trim() || `${from.theme.name} copy`).slice(0, 40);
  const id = freeId(dir, title);
  const { $schema: _, ...rest } = from.theme;
  const theme = { ...rest, name: title };
  const file = join(dir, `${id}.json`);
  writeFileSync(file, `${JSON.stringify({ $schema: `./${SCHEMA_FILE}`, ...theme }, null, 2)}\n`);
  return { id, theme, builtIn: false, file };
}

/** the id for a theme called `name`: its words in lowercase joined by hyphens, never a built-in one or a file there (`keep`, the theme's own, may stay) */
function freeId(dir: string, name: string, keep?: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'my-theme';
  const taken = (id: string) => id !== keep && (BUILTIN_THEMES.some((b) => b.id === id) || existsSync(join(dir, `${id}.json`)));
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/** A theme of the person's own under a new name; its file follows the name, and the rest of the file stays as written. */
export function renameTheme(dir: string, entry: ThemeEntry, name: string): ThemeEntry {
  const title = name.trim().slice(0, 40);
  const id = freeId(dir, title, entry.id);
  const file = join(dir, `${id}.json`);
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(entry.file!, 'utf8')), name: title }, null, 2)}\n`);
  if (file !== entry.file) rmSync(entry.file!);
  return { id, theme: { ...entry.theme, name: title }, builtIn: false, file };
}

/** A theme of the person's own, gone: its file is removed (a browser that wore it goes back to the default). */
export const deleteTheme = (entry: ThemeEntry) => rmSync(entry.file!);

/** A theme of the person's own as its file says it, to save elsewhere. */
export const themeFileText = (entry: ThemeEntry) => readFileSync(entry.file!, 'utf8');

/**
 * A theme file from elsewhere (its name and its text), checked as the folder's own files are, then written under its
 * file's name where that is free (else with a number) and naming the schema beside it, so an editor checks it here too.
 */
export function importTheme(dir: string, fileName: string, text: string): ThemeEntry | { error: string } {
  if (Buffer.byteLength(text) > MAX_BYTES) return { error: 'larger than 64 KB, which no theme needs' };
  const r = parseTheme(text);
  if ('error' in r) return { error: r.error };
  prepareThemesDir(dir);
  const id = freeId(dir, fileName.replace(/\.json$/i, '') || r.theme.name);
  const { $schema: _, ...rest } = JSON.parse(text) as Record<string, unknown>;
  const file = join(dir, `${id}.json`);
  writeFileSync(file, `${JSON.stringify({ $schema: `./${SCHEMA_FILE}`, ...rest }, null, 2)}\n`);
  return { id, theme: r.theme, builtIn: false, file };
}
