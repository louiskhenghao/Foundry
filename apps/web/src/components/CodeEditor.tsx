import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../ui.tsx';

/** a line inside a merge conflict: the markers, our side, the common ancestor (diff3) or their side */
type Region = 'marker' | 'ours' | 'base' | 'theirs' | null;

/** which conflict region each line belongs to, from git's markers */
export function conflictRegions(lines: string[]): Region[] {
  let region: Region = null;
  return lines.map((l) => {
    if (/^<{7}( |$)/.test(l)) {
      region = 'ours';
      return 'marker';
    }
    if (/^\|{7}( |$)/.test(l)) {
      region = 'base';
      return 'marker';
    }
    if (/^={7}$/.test(l) && region) {
      region = 'theirs';
      return 'marker';
    }
    if (/^>{7}( |$)/.test(l)) {
      region = null;
      return 'marker';
    }
    return region;
  });
}

/**
 * A region's tint, in the theme's colours as the page's legend says them: ours (what has landed) green, theirs (what comes
 * in) blue, the common ancestor grey, and the markers yellow — they wait for you to remove them.
 */
const TINT: Record<Exclude<Region, null>, string> = {
  marker: 'bg-you/25',
  ours: 'bg-ok/10',
  base: 'bg-ink-faint/10',
  theirs: 'bg-work/10',
};

/** px per line: the editor and its colours must stay on the same grid */
const LINE = 20;

/**
 * A plain textarea over its own syntax colouring, with line numbers: the text is edited as in any field, the colours
 * and a conflict's regions (ours, theirs, the markers) show through behind it. The colouring follows the text a beat
 * later, so a long file stays responsive while typing.
 */
export function CodeEditor({ value, onChange, name, className }: { value: string; onChange: (v: string) => void; name: string; className?: string }) {
  const shown = useDeferredValue(value);
  const lines = useMemo(() => shown.split('\n'), [shown]);
  const regions = useMemo(() => conflictRegions(lines), [lines]);
  const [html, setHtml] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      import('./highlight.ts')
        .then(({ highlightLines, languageOf }) => alive && setHtml(highlightLines(shown, languageOf(name))))
        .catch(() => {});
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [shown, name]);
  const longest = useMemo(() => Math.max(...value.split('\n').map((l) => l.length), 0), [value]);
  const count = value.split('\n').length;
  const area = useRef<HTMLTextAreaElement>(null);
  const style = { height: count * LINE + 16, minWidth: `calc(${longest + 4}ch + 1.5rem)` };
  return (
    // a box inside the page's panel; the line numbers stay put on the inset colour while the code scrolls sideways
    <div className={cn('rounded-md border border-line bg-inset overflow-auto', className ?? 'max-h-[60vh]')} onClick={() => area.current?.focus()}>
      <div className="flex mono text-xs" style={{ lineHeight: `${LINE}px` }}>
        <div className="select-none py-2 pl-3 pr-3 text-right text-ink-faint sticky left-0 bg-inset border-r border-line z-10" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="relative flex-1" style={style}>
          {/* the colours behind: one row per line, tinted by its conflict region */}
          <div className="absolute inset-0 py-2 pr-3 pointer-events-none" aria-hidden="true">
            {lines.map((l, i) => {
              const r = regions[i] ?? null;
              const cls = cn('pl-2 whitespace-pre', r ? TINT[r] : null);
              return r === 'marker' || html?.[i] == null ? (
                <div key={i} className={cn(cls, 'text-ink')}>
                  {l || ' '}
                </div>
              ) : (
                // highlight.js escapes the source; its output is only span tags
                <div key={i} className={cn(cls, 'hl text-ink')} dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} />
              );
            })}
          </div>
          <textarea
            ref={area}
            className="absolute inset-0 w-full h-full resize-none overflow-hidden bg-transparent py-2 pl-2 pr-3 whitespace-pre text-transparent caret-ink outline-none selection:bg-work/30"
            style={{ lineHeight: `${LINE}px` }}
            spellCheck={false}
            wrap="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`Merged content of ${name}`}
          />
        </div>
      </div>
    </div>
  );
}
