export interface SkillFrontmatter {
  name: string | null;
  description: string;
  version: string | null;
  raw: Record<string, string>;
}

/**
 * Tolerant SKILL.md frontmatter parser. Handles `key: value`, quoted values, `>`/`|` block
 * scalars and indented continuation lines. Never throws; unknown shapes degrade to raw text.
 */
export function parseSkillMd(text: string): SkillFrontmatter {
  const raw: Record<string, string> = {};
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    const lines = m[1]!.split(/\r?\n/);
    let key: string | null = null;
    let block: 'fold' | 'keep' | null = null;
    let buf: string[] = [];
    const flush = () => {
      if (key) raw[key] = block === 'fold' ? buf.map((l) => l.trim()).filter(Boolean).join(' ') : buf.join('\n').trim();
      key = null;
      block = null;
      buf = [];
    };
    for (const line of lines) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
      if (kv && !line.startsWith(' ') && !line.startsWith('\t')) {
        flush();
        key = kv[1]!;
        const v = kv[2]!.trim();
        if (v === '>' || v === '>-' || v === '|' || v === '|-') {
          block = v.startsWith('>') ? 'fold' : 'keep';
        } else {
          raw[key] = unquote(v);
          key = null;
        }
      } else if (key && (line.startsWith(' ') || line.startsWith('\t') || line.trim() === '')) {
        buf.push(line.replace(/^\s{1,4}/, ''));
      } else if (!key && line.trim().startsWith('- ')) {
        // list item under a previous scalar key: append to last key
        const last = Object.keys(raw).at(-1);
        if (last) raw[last] = (raw[last] ? raw[last] + ', ' : '') + line.trim().slice(2);
      }
    }
    flush();
  }
  return {
    name: raw.name?.trim() || null,
    description: (raw.description ?? '').trim(),
    version: raw.version?.trim() || null,
    raw,
  };
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}
