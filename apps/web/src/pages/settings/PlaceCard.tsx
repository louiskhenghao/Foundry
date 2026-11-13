import { Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SimpleIcon } from 'simple-icons';
import { cn } from '../../ui.tsx';

/** whether a place's credentials are in: all of what it needs, some of it, or none */
export type PlaceStatus = 'set' | 'partial' | 'unset';
const PILL = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset';
const PILL_BY: Record<PlaceStatus, string> = { set: 'bg-ok/10 text-ok-ink ring-ok/30', partial: 'bg-you/10 text-you-ink ring-you/30', unset: 'bg-sunken text-ink-faint ring-line' };
const WORDS: Record<PlaceStatus, string> = { set: 'Set up', partial: 'Partly set', unset: 'Not set up' };

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

/** one step of a place's set-up: the tool, the access, the details — numbered, ticked once done, on one line down the card */
function Step({ n, done, title, children }: { n: number; done: boolean | null; title: string; children: ReactNode }) {
  return (
    <li className="relative pl-7">
      <span className={cn('absolute left-0 top-0 grid size-5 place-items-center rounded-full text-[10px] font-bold ring-1 ring-inset', done ? 'bg-ok text-white ring-ok' : 'bg-surface text-ink-soft ring-line-strong')} aria-label={done ? `${title}: done` : title}>
        {done ? <Check size={11} strokeWidth={3} /> : n}
      </span>
      <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint leading-5">{title}</div>
      <div className="text-[11px]">{children}</div>
    </li>
  );
}

/** the tool a place is reached with, when it is one fetched on first use or none at all: nothing to install */
export function ToolNote({ children }: { children: ReactNode }) {
  return <div className="text-ink-soft">{children}</div>;
}
/** the pages a place's values come from, with what to do there */
export function TokenLinks({ where, lead = 'Make it on' }: { where: { label: string; href: string; note: string }[]; lead?: string }) {
  return (
    <ul className="space-y-0.5 text-ink-soft">
      {where.map((w, i) => (
        <li key={w.href}>
          {i === 0 ? `${lead} ` : 'or '}
          <a href={w.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-work-ink hover:underline">
            {w.label} <ExternalLink size={10} />
          </a>{' '}
          <span className="text-ink-faint">— {w.note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One place a deploy can go (a host, a platform, a store) as a card in Settings: its logo, name and whether it is set
 * up on the closed card; opened, the set-up as three steps down one line — the tool it is reached with, the access
 * (a sign-in through the CLI, or the page a token is made on) and the fields themselves — each ticked once done.
 */
export function PlaceCard({ id, logo, name, tagline, status, open, onToggle, tool, toolDone, access, children }: { id: string; /** the place's own logo, on a tile of its brand colour */ logo: SimpleIcon; name: string; /** one line on what the place is for */ tagline: string; status: PlaceStatus; open: boolean; onToggle: () => void; /** step 1: the tool, present or installed on a click, or nothing to install */ tool: ReactNode; /** whether the tool is there; null = nothing to install (shown as done) */ toolDone: boolean | null; /** step 2: the sign-in, or where the token is made */ access: ReactNode; children: ReactNode }) {
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
        <div id={`place-${id}`} className="border-t border-line px-4 py-3">
          <ol className="relative space-y-4 before:absolute before:left-[9px] before:top-5 before:bottom-5 before:w-px before:bg-line">
            <Step n={1} done={toolDone === null ? true : toolDone} title="The tool">
              {tool}
            </Step>
            <Step n={2} done={status === 'set'} title="Access">
              {access}
            </Step>
            <Step n={3} done={status === 'set'} title="What Foundry keeps">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>
            </Step>
          </ol>
        </div>
      )}
    </div>
  );
}
