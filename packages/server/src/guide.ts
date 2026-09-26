import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The user guide, in reading order. Pages not listed here are appended alphabetically. */
export const GUIDE_ORDER = ['index', 'your-first-goal', 'answering-the-interview', 'approving-the-brief', 'while-it-runs', 'when-foundry-needs-you', 'getting-the-result', 'settings', 'costs-and-usage', 'faq'];

/** The first page is README.md so GitHub shows it when docs/guide/ is opened; the app calls it "index". */
export const guideFile = (slug: string) => (slug === 'index' ? 'README' : slug);
const slugOf = (file: string) => (file === 'README' ? 'index' : file);

export interface GuidePage {
  slug: string;
  title: string;
  /** the 中文 title; null = no 中文 version */
  zh: string | null;
}

/** The pages of docs/guide/ shipped with this install (the Docker image carries them too). */
export function listGuide(dir: string): GuidePage[] {
  if (!existsSync(dir)) return [];
  const slugs = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.zh.md'))
    .map((f) => slugOf(f.slice(0, -3)));
  const order = (s: string) => (GUIDE_ORDER.includes(s) ? GUIDE_ORDER.indexOf(s) : GUIDE_ORDER.length);
  return slugs
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((slug) => {
      const zh = join(dir, `${guideFile(slug)}.zh.md`);
      return { slug, title: titleOf(readFileSync(join(dir, `${guideFile(slug)}.md`), 'utf8')) ?? slug, zh: existsSync(zh) ? (titleOf(readFileSync(zh, 'utf8')) ?? slug) : null };
    });
}

/** One page's markdown in the asked language, falling back to English. null = no such page. */
export function readGuide(dir: string, slug: string, lang: 'en' | 'zh'): { markdown: string; lang: 'en' | 'zh' } | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const zh = join(dir, `${guideFile(slug)}.zh.md`);
  if (lang === 'zh' && existsSync(zh)) return { markdown: readFileSync(zh, 'utf8'), lang: 'zh' };
  const en = join(dir, `${guideFile(slug)}.md`);
  return existsSync(en) ? { markdown: readFileSync(en, 'utf8'), lang: 'en' } : null;
}

function titleOf(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : null;
}
