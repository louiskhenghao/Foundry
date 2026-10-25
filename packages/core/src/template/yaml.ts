/**
 * The small YAML a template's frontmatter is written in (ADR-0079): maps, lists, scalars, `|` and `>` blocks and
 * `[a, b]` flow lists — what a person writes by hand and what Foundry writes back. Not a YAML parser: anchors, tags,
 * multi-line flow collections and documents are refused with the line that could not be read, never guessed at.
 */

export class YamlError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
  }
}

type Scalar = string | number | boolean | null;
export type YamlValue = Scalar | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  /** 1-based, in the frontmatter */
  n: number;
  indent: number;
  text: string;
}

/** the lines that say something: blank lines and comment lines are skipped; a tab in the indentation is refused */
function lines(text: string): Line[] {
  const out: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim() || /^\s*#/.test(raw)) return;
    const m = /^( *)(\t*)/.exec(raw)!;
    if (m[2]) throw new YamlError('indent with spaces, not tabs', n);
    out.push({ n, indent: m[1]!.length, text: raw.slice(m[1]!.length).replace(/\s+$/, '') });
  });
  return out;
}

/** `key: rest` — a key is a word (letters, digits, _ and -), never quoted, never empty */
const KEY = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/;

/** a scalar as YAML reads it: quoted text, true/false/null, a number, else the plain words (a ` # comment` dropped) */
export function scalar(raw: string, n: number): Scalar {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = closingQuote(v, '"');
    if (end < 0 || v.slice(end + 1).replace(/\s+#.*$/, '').trim()) throw new YamlError('a quoted value ends with its quote', n);
    try {
      return JSON.parse(v.slice(0, end + 1)) as string;
    } catch {
      throw new YamlError('a quoted value with an escape JSON would not read', n);
    }
  }
  if (v.startsWith("'")) {
    const end = closingQuote(v, "'");
    if (end < 0 || v.slice(end + 1).replace(/\s+#.*$/, '').trim()) throw new YamlError('a quoted value ends with its quote', n);
    return v.slice(1, end).replace(/''/g, "'");
  }
  const plain = v.replace(/\s+#.*$/, '').trim();
  if (plain === 'true') return true;
  if (plain === 'false') return false;
  if (plain === 'null' || plain === '~' || plain === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(plain)) return Number(plain);
  if (/^[&*!%@`]/.test(plain)) throw new YamlError(`a value cannot start with ${plain[0]}: quote it`, n);
  return plain;
}

/** the index of the quote that closes a quoted value opened at 0 (JSON escapes, or doubled single quotes) */
function closingQuote(v: string, q: '"' | "'"): number {
  for (let i = 1; i < v.length; i++) {
    if (q === '"' && v[i] === '\\') {
      i++;
      continue;
    }
    if (v[i] === q) {
      if (q === "'" && v[i + 1] === "'") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** `[a, b, "c, d"]` */
function flowList(raw: string, n: number): Scalar[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  const items: Scalar[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"') cur += inner[++i] ?? '';
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(scalar(cur, n));
      cur = '';
    } else cur += ch;
  }
  if (quote) throw new YamlError('a quoted value ends with its quote', n);
  items.push(scalar(cur, n));
  return items;
}

class Parser {
  private i = 0;
  constructor(private readonly ls: Line[]) {}

  parse(): YamlValue {
    if (!this.ls.length) return {};
    const v = this.block(this.ls[0]!.indent);
    if (this.i < this.ls.length) throw new YamlError('this line is indented under nothing', this.ls[this.i]!.n);
    return v;
  }

  private peek(): Line | undefined {
    return this.ls[this.i];
  }

  /** a map or a list whose entries sit at `indent` */
  private block(indent: number): YamlValue {
    const first = this.peek()!;
    return first.text.startsWith('- ') || first.text === '-' ? this.list(indent) : this.map(indent);
  }

  private map(indent: number): { [key: string]: YamlValue } {
    const out: { [key: string]: YamlValue } = {};
    for (let l = this.peek(); l && l.indent === indent; l = this.peek()) {
      if (l.text.startsWith('- ') || l.text === '-') throw new YamlError('a list item where a key was expected', l.n);
      const m = KEY.exec(l.text);
      if (!m) throw new YamlError('expected `key: value`', l.n);
      if (m[1]! in out) throw new YamlError(`${m[1]} is given twice`, l.n);
      this.i++;
      out[m[1]!] = this.value(m[2], l, indent);
    }
    const next = this.peek();
    if (next && next.indent > indent) throw new YamlError('this line is indented under nothing', next.n);
    return out;
  }

  private list(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    for (let l = this.peek(); l && l.indent === indent; l = this.peek()) {
      if (!(l.text.startsWith('- ') || l.text === '-')) throw new YamlError('expected a `- ` list item', l.n);
      this.i++;
      const rest = l.text.slice(1).trim();
      const km = KEY.exec(rest);
      if (km && !rest.startsWith('"') && !rest.startsWith("'")) {
        // `- key: value`: a map whose first key is on the dash's line, the rest two columns in
        const inner = indent + 2;
        const item: { [key: string]: YamlValue } = { [km[1]!]: this.value(km[2], l, inner) };
        for (let n = this.peek(); n && n.indent === inner && !n.text.startsWith('- '); n = this.peek()) {
          const m = KEY.exec(n.text);
          if (!m) throw new YamlError('expected `key: value`', n.n);
          if (m[1]! in item) throw new YamlError(`${m[1]} is given twice`, n.n);
          this.i++;
          item[m[1]!] = this.value(m[2], n, inner);
        }
        const next = this.peek();
        if (next && next.indent > indent && next.indent !== inner) throw new YamlError('a list item\'s keys line up two columns in from its dash', next.n);
        out.push(item);
      } else out.push(this.value(rest || undefined, l, indent));
    }
    const next = this.peek();
    if (next && next.indent > indent) throw new YamlError('this line is indented under nothing', next.n);
    return out;
  }

  /** what follows a key or a dash: a scalar on the line, a flow list, a block scalar, or a block on the next lines */
  private value(rest: string | undefined, at: Line, indent: number): YamlValue {
    const r = rest?.trim() ?? '';
    if (r === '|' || r === '|-' || r === '>' || r === '>-') return this.blockScalar(r, at, indent);
    if (r.startsWith('[')) {
      if (!r.replace(/\s+#.*$/, '').trim().endsWith(']')) throw new YamlError('a [list] closes on its line', at.n);
      return flowList(r.replace(/\s+#.*$/, ''), at.n);
    }
    if (r.startsWith('{')) throw new YamlError('write a map on its own lines, not in braces', at.n);
    if (r && !/^#/.test(r)) return scalar(r, at.n);
    const next = this.peek();
    if (next && next.indent > indent) return this.block(next.indent);
    return null;
  }

  /** `|` keeps the lines, `>` folds them into one; a `-` strips the final newline (both forms end without one here) */
  private blockScalar(kind: string, at: Line, indent: number): string {
    const buf: string[] = [];
    const next = this.peek();
    if (!next || next.indent <= indent) return '';
    const inner = next.indent;
    // blank lines inside the block are kept: read them back from the raw text between the lines that say something
    for (let l = this.peek(); l && l.indent >= inner; l = this.peek()) {
      const gap = buf.length ? l.n - (this.ls[this.i - 1]!.n + 1) : 0;
      for (let g = 0; g < gap; g++) buf.push('');
      buf.push(' '.repeat(l.indent - inner) + l.text);
      this.i++;
    }
    const after = this.peek();
    if (after && after.indent > indent) throw new YamlError('this line is indented under nothing', after.n);
    if (kind.startsWith('|')) return buf.join('\n');
    // folded: single newlines become spaces, blank lines stay paragraph breaks
    return buf
      .join('\n')
      .split(/\n{2,}/)
      .map((p) => p.split('\n').map((s) => s.trim()).join(' '))
      .join('\n\n');
  }
}

/** the frontmatter's text as a value; `{}` when there is nothing in it */
export function parseYaml(text: string): YamlValue {
  return new Parser(lines(text)).parse();
}

const PLAIN = /^[A-Za-z0-9_][^#:\[\]{}"'`&*!%@|>,\n]*$/;
/** a string as this YAML writes it: plain where YAML would read it back as the same string, else quoted */
export function yamlString(s: string): string {
  // the words other YAML readers take for booleans (on, yes…) are quoted too, so a file edited elsewhere reads the same
  if (s === '' || s !== s.trim() || !PLAIN.test(s) || /^(true|false|null|~|on|off|yes|no|y|n|-?\d+(\.\d+)?)$/i.test(s) || s.includes(': ') || s.endsWith(':')) return JSON.stringify(s);
  return s;
}

/**
 * A value as this YAML writes it: maps and lists of maps in block form, lists of short scalars in flow form, a string
 * with newlines as a `|` block. Keys are written in the order given; undefined values are left out.
 */
export function yamlText(value: YamlValue, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]\n`;
    if (value.every((v) => v === null || typeof v !== 'object')) {
      const short = value.every((v) => typeof v !== 'string' || (v.length <= 40 && !v.includes('\n')));
      if (short) return `${pad}[${(value as Scalar[]).map((v) => scalarText(v)).join(', ')}]\n`;
    }
    return value
      .map((v) => {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          const entries = Object.entries(v).filter(([, x]) => x !== undefined);
          if (!entries.length) return `${pad}- {}\n`;
          // the item's keys sit two columns in from the dash, what hangs under a key two more
          const [k0, v0] = entries[0]!;
          const first = `${pad}- ${k0}:${inline(v0, indent + 4)}`;
          const rest = entries.slice(1).map(([k, x]) => `${pad}  ${k}:${inline(x, indent + 4)}`);
          return [first, ...rest].join('');
        }
        return `${pad}-${inline(v, indent + 2)}`;
      })
      .join('');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, x]) => x !== undefined);
    if (!entries.length) return `${pad}{}\n`;
    return entries.map(([k, x]) => `${pad}${k}:${inline(x, indent + 2)}`).join('');
  }
  return `${pad}${scalarText(value)}\n`;
}

/** what follows `key:` or `-`: a scalar on the same line, or a block on the lines below */
function inline(v: YamlValue, indent: number): string {
  if (Array.isArray(v)) {
    if (!v.length) return ' []\n';
    if (v.every((x) => x === null || typeof x !== 'object') && v.every((x) => typeof x !== 'string' || (x.length <= 40 && !x.includes('\n')))) return ` ${yamlText(v).trimStart()}`;
    return `\n${yamlText(v, indent)}`;
  }
  if (v !== null && typeof v === 'object') return Object.keys(v).length ? `\n${yamlText(v, indent)}` : ' {}\n';
  if (typeof v === 'string' && v.includes('\n')) return ` |\n${v.split('\n').map((l) => (l ? ' '.repeat(indent) + l : '')).join('\n')}\n`;
  return ` ${scalarText(v)}\n`;
}

const scalarText = (v: Scalar): string => (v === null ? 'null' : typeof v === 'string' ? yamlString(v) : String(v));
