import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SimpleIcon } from 'simple-icons';
import { cn } from '../../ui.tsx';

/** a brand's logo from Simple Icons (CC0): its path on a 24-unit square, drawn in the colour the tile asks for */
export function BrandLogo({ icon, size = 16 }: { icon: SimpleIcon; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={icon.title} fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}
/** white or near-black on the brand's colour, whichever reads */
const onBrand = (hex: string) => {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#111111' : '#ffffff';
};

/** whether a place's credentials are in: all of what it needs, some of it, or none */
export type PlaceStatus = 'set' | 'partial' | 'unset';
const PILL = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset';
const PILL_BY: Record<PlaceStatus, string> = { set: 'bg-ok/10 text-ok-ink ring-ok/30', partial: 'bg-you/10 text-you-ink ring-you/30', unset: 'bg-sunken text-ink-faint ring-line' };
const WORDS: Record<PlaceStatus, string> = { set: 'Set up', partial: 'Partly set', unset: 'Not set up' };

/**
 * One place a deploy can go (a host, a platform, a store) as a card in Settings: its icon, name and whether it is set
 * up on the closed card; its fields, each with where the value comes from, once opened. One place, one card, so the
 * fields of two places never sit on one line.
 */
export function PlaceCard({ id, logo, name, tagline, status, open, onToggle, where, children }: { id: string; /** the place's own logo, on a tile of its brand colour */ logo: SimpleIcon; name: string; /** one line on what the place is for */ tagline: string; status: PlaceStatus; open: boolean; onToggle: () => void; /** the pages the values come from, with what to do there */ where?: { label: string; href: string; note: string }[]; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border bg-surface', open ? 'border-line-strong' : 'border-line')} data-place={id}>
      <button type="button" aria-expanded={open} aria-controls={`place-${id}`} onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="grid size-8 shrink-0 place-items-center rounded-md ring-1 ring-inset ring-black/10" style={{ background: `#${logo.hex}`, color: onBrand(logo.hex) }} title={logo.title}>
          <BrandLogo icon={logo} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{name}</span>
          <span className="block text-[11px] text-ink-faint">{tagline}</span>
        </span>
        <span className={cn(PILL, PILL_BY[status])}>{WORDS[status]}</span>
        {open ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
      </button>
      {open && (
        <div id={`place-${id}`} className="space-y-3 border-t border-line px-3 py-3">
          {where && where.length > 0 && (
            <div className="rounded-md bg-sunken px-3 py-2 text-[11px] text-ink-soft">
              <span className="font-semibold text-ink">Where the values come from</span>
              <ul className="mt-1 space-y-0.5">
                {where.map((w) => (
                  <li key={w.href}>
                    <a href={w.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-work-ink hover:underline">
                      {w.label} <ExternalLink size={10} />
                    </a>{' '}
                    <span className="text-ink-faint">— {w.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>
        </div>
      )}
    </div>
  );
}
