import { TITLE_CUT } from '@foundry/core/browser';

/** the line is the title, or the title is the line cut short (the goal's name until the Clarifier gives it one) */
function isTitle(line: string, title: string): boolean {
  const t = title.trim();
  return line === t || (t.length >= TITLE_CUT && line.startsWith(t));
}

/**
 * The goal header's excerpt of a description as plain words: a description written from a template is Markdown, and the
 * header shows two lines of it under the title. Marks go (headings, emphasis, code ticks, list bullets), a heading runs
 * into its section ("How to see it: …"), and a first line that is the title itself — or that the title was cut from —
 * is not said twice.
 */
export function goalExcerpt(prompt: string, title: string): string {
  const lines = prompt.split('\n').map((l) => l.trim()).filter(Boolean);
  const words = (l: string) => l.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+|^\d+[.)]\s+/, '').replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$|[.,;:!?])/g, '$1$2').trim();
  const out: string[] = [];
  lines.forEach((line, i) => {
    const text = words(line);
    if (!text) return;
    if (i === 0 && isTitle(text, title)) return;
    const heading = /^#{1,6}\s/.test(line) && i > 0;
    out.push(heading && !/[.:!?]$/.test(text) ? `${text}:` : text);
  });
  return out.join(' ');
}
