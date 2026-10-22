import { useEffect, useState } from 'react';
import { chipClass, cn, navItemClass } from '../ui.tsx';

/** One section of a page's menu. */
export interface NavSection {
  id: string;
  label: string;
  /** a short count or state beside the label */
  status?: string | null;
  /** the section needs attention: its status on a yellow plate */
  warn?: boolean;
  /** the section's category colour, a `bg-…` class (code(i).dot); grey when left out */
  dot?: string;
}

/** the section's colour, as a small square before its name */
const Dot = ({ dot }: { dot?: string }) => <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', dot ?? 'bg-line-strong')} aria-hidden="true" />;

/** how a section stands, in mono: on a yellow plate when it needs you (as the Overview tab's count), else quiet */
function Status({ item, onAccent = false }: { item: NavSection; /** drawn on the chosen chip's accent fill */ onAccent?: boolean }) {
  if (!item.status) return null;
  return <span className={cn('mono shrink-0 whitespace-nowrap text-[11px] leading-[1.125rem]', item.warn ? 'rounded-[5px] bg-you px-1.5 font-bold text-on-you' : onAccent ? 'text-on-accent/75' : 'text-ink-faint')}>{item.status}</span>;
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
 * A page's sections as a list beside it, staying in view on a wide screen (the Brief, New goal): click one to jump there;
 * the one you are reading is marked, and each shows its colour and how it stands. Narrower screens get SectionChipNav.
 */
export function SectionSideNav({ items, label }: { items: NavSection[]; /** what the menu is, for a screen reader */ label: string }) {
  const active = useActiveSection(items.map((i) => i.id));
  return (
    // pinned a little under the top of the page while the page scrolls beside it
    <nav aria-label={label} className="hidden lg:block sticky top-4 self-start max-h-[calc(100dvh-5.5rem)] overflow-auto py-1 space-y-0.5">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => go(i.id)} aria-current={active === i.id ? 'location' : undefined} className={navItemClass(active === i.id)}>
          <span className="flex items-center gap-2">
            <Dot dot={i.dot} />
            <span className="min-w-0 flex-1">{i.label}</span>
            <Status item={i} />
          </span>
        </button>
      ))}
    </nav>
  );
}

/** The same sections as a row of chips stuck to the top of a narrow screen, scrolling sideways. */
export function SectionChipNav({ items, label }: { items: NavSection[]; label: string }) {
  const active = useActiveSection(items.map((i) => i.id));
  return (
    // on the page's own colour with a hairline under it: the sections scroll beneath it
    <nav aria-label={label} className="lg:hidden sticky top-0 z-20 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-2 bg-page border-b border-line flex gap-1.5 overflow-x-auto whitespace-nowrap">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => go(i.id)} aria-current={active === i.id ? 'location' : undefined} className={cn(chipClass(active === i.id), 'shrink-0 inline-flex items-center gap-1.5')}>
          <Dot dot={i.dot} />
          {i.label}
          <Status item={i} onAccent={active === i.id} />
        </button>
      ))}
    </nav>
  );
}
