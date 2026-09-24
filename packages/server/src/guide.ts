import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The user guide, in reading order. Pages not listed here are appended alphabetically. */
export const GUIDE_ORDER = ['index', 'your-first-goal', 'answering-the-interview', 'approving-the-brief', 'while-it-runs', 'when-foundry-needs-you', 'getting-the-result', 'settings', 'costs-and-usage', 'faq'];

export interface GuidePage {
  slug: string;
  title: string;
  /** a 中文 version exists */
  zh: boolean;
}

/** The pages of docs/guide/ shipped with this install (the Docker image carries them too). */
export function listGuide(dir: string): GuidePage[] {
  if (!existsSync(dir)) return [];
  const slugs = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.endsWith('.zh.md'))
    .map((f) => f.slice(0, -3));
  const order = (s: string) => (GUIDE_ORDER.includes(s) ? GUIDE_ORDER.indexOf(s) : GUIDE_ORDER.length);
  return slugs
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((slug) => ({ slug, title: titleOf(readFileSync(join(dir, `${slug}.md`), 'utf8')) ?? slug, zh: existsSync(join(dir, `${slug}.zh.md`)) }));
}

/** One page's markdown in the asked language, falling back to English. null = no such page. */
export function readGuide(dir: string, slug: string, lang: 'en' | 'zh'): { markdown: string; lang: 'en' | 'zh' } | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const zh = join(dir, `${slug}.zh.md`);
  if (lang === 'zh' && existsSync(zh)) return { markdown: readFileSync(zh, 'utf8'), lang: 'zh' };
  const en = join(dir, `${slug}.md`);
  return existsSync(en) ? { markdown: readFileSync(en, 'utf8'), lang: 'en' } : null;
}

function titleOf(md: string): string | null {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : null;
}
