import { useEffect, useState } from 'react';
import { cn } from '../../ui.tsx';

export interface BriefNavItem {
  id: string;
  label: string;
  /** a short count or state beside the label */
  status?: string | null;
  /** the section needs attention (blocking questions, decisions not applied, areas without tasks) */
  warn?: boolean;
}

/** the section nearest the top of the page; the scroller is <main>, not the window */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join(',');
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActive(top.target.id);
      },
      { root: document.querySelector('main'), rootMargin: '-15% 0px -70% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);
  return active;
}

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The Brief's sections as a list beside it (wide screens) or a row of tabs above it (narrow ones): click one to jump
 * there; the one you are reading is highlighted, and each says how it stands.
 */
export function BriefSideNav({ items }: { items: BriefNavItem[] }) {
  const active = useActiveSection(items.map((i) => i.id));
  return (
    <nav aria-label="Brief sections" className="hidden lg:block sticky top-0 self-start max-h-screen overflow-auto py-1 space-y-0.5">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => go(i.id)} aria-current={active === i.id ? 'location' : undefined} className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs', active === i.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900')}>
          <span className="min-w-0 flex-1 truncate">{i.label}</span>
          {i.status && <span className={cn('shrink-0 text-[10px] tabular-nums', i.warn ? 'text-amber-300' : 'text-zinc-500')}>{i.status}</span>}
        </button>
      ))}
    </nav>
  );
}

export function BriefChipNav({ items }: { items: BriefNavItem[] }) {
  const active = useActiveSection(items.map((i) => i.id));
  return (
    <nav aria-label="Brief sections" className="lg:hidden sticky top-0 z-20 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-2 bg-zinc-950/95 backdrop-blur flex gap-1.5 overflow-x-auto whitespace-nowrap">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => go(i.id)} aria-current={active === i.id ? 'location' : undefined} className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px]', active === i.id ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-zinc-800 text-zinc-400')}>
          {i.label}
          {i.status && <span className={cn('ml-1.5', i.warn ? 'text-amber-300' : 'text-zinc-500')}>{i.status}</span>}
        </button>
      ))}
    </nav>
  );
}
