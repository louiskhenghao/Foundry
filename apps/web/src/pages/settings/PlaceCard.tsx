import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../ui.tsx';

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
export function PlaceCard({ id, icon, name, tagline, status, open, onToggle, where, children }: { id: string; icon: ReactNode; name: string; /** one line on what the place is for */ tagline: string; status: PlaceStatus; open: boolean; onToggle: () => void; /** the pages the values come from, with what to do there */ where?: { label: string; href: string; note: string }[]; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border bg-surface', open ? 'border-line-strong' : 'border-line')} data-place={id}>
      <button type="button" aria-expanded={open} aria-controls={`place-${id}`} onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-md ring-1 ring-inset', status === 'set' ? 'bg-ok/10 text-ok-ink ring-ok/30' : 'bg-sunken text-ink-soft ring-line')}>{icon}</span>
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
