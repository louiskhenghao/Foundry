import { useEffect, useRef, useState } from 'react';
import { chipClass, cn, navItemClass } from '../ui.tsx';

/** One section of a page's menu. */
export interface NavSection {
  id: string;
  label: string;
  /** a short count or state beside the label */
  status?: string | null;
  /** the section needs attention: its status on a yellow plate */
  warn?: boolean;
  /** how its status stands, in that signal colour: work under way (blue), a check passed (green), a problem (red) */
  tone?: 'work' | 'ok' | 'bad';
  /** the section's category colour, a `bg-…` class (code(i).dot); grey when left out */
  dot?: string;
}

/** the section's colour, as a small square before its name */
const Dot = ({ dot }: { dot?: string }) => <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', dot ?? 'bg-line-strong')} aria-hidden="true" />;

const TONE = { work: 'font-semibold text-work-ink', ok: 'font-semibold text-ok-ink', bad: 'font-semibold text-bad-ink' };

/** how a section stands, in mono: on a yellow plate when it needs you (as the Overview tab's count), in its signal colour when it has one, else quiet */
function Status({ item, onAccent = false }: { item: NavSection; /** drawn on the chosen chip's accent fill */ onAccent?: boolean }) {
  if (!item.status) return null;
  return <span className={cn('mono shrink-0 whitespace-nowrap text-[11px] leading-[1.125rem]', item.warn ? 'rounded-[5px] bg-you px-1.5 font-bold text-on-you' : onAccent ? 'text-on-accent/75' : item.tone ? TONE[item.tone] : 'text-ink-faint')}>{item.status}</span>;
}

/**
 * The section you are at, and a jump to one; the scroller is <main>, not the window. A section jumped to is marked at once
 * and stays marked once the jump has settled, even where the page ends before that section can reach the top.
 */
function useActiveSection(ids: string[]): { active: string | null; jump: (id: string) => void } {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  /** the section a jump goes to, while its scrolling goes on */
  const jumped = useRef<string | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const key = ids.join(',');
  /** at either end of the page the first or the last section; else the last whose top has passed a line a quarter of the way down */
  const current = () => {
    const main = document.querySelector('main');
    if (!main || main.scrollTop <= 0) return ids[0] ?? null;
    if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) return ids[ids.length - 1] ?? null;
    const line = main.getBoundingClientRect().top + main.clientHeight / 4;
    return ids.filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line).pop() ?? ids[0] ?? null;
  };
  /** a jump has settled once its scrolling stops for a moment: its section stays marked if in view, else (you scrolled away meanwhile) where you are is */
  const holdOn = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const box = document.getElementById(jumped.current ?? '')?.getBoundingClientRect();
      const view = document.querySelector('main')?.getBoundingClientRect();
      jumped.current = null;
      if (!box || !view || box.bottom < view.top || box.top > view.bottom) setActive(current());
    }, 200);
  };
  useEffect(() => {
    const main = document.querySelector('main');
    let frame = 0;
    const onScroll = () => {
      if (jumped.current) return holdOn();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(current()));
    };
    setActive(current());
    main?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main?.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(settle.current);
    };
  }, [key]);
  const jump = (id: string) => {
    jumped.current = id;
    setActive(id);
    holdOn();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return { active, jump };
}

/**
 * A page's sections as a list beside it, staying in view on a wide screen (the Brief, New goal, Settings): click one to
 * jump there; the one you are reading is marked, and each shows its colour and how it stands. Narrower screens get
 * SectionChipNav.
 */
export function SectionSideNav({ items, label }: { items: NavSection[]; /** what the menu is, for a screen reader */ label: string }) {
  const { active, jump } = useActiveSection(items.map((i) => i.id));
  return (
    // pinned a little under the top of the page while the page scrolls beside it
    <nav aria-label={label} className="hidden lg:block sticky top-4 self-start max-h-[calc(100dvh-5.5rem)] overflow-auto py-1 space-y-0.5">
      {items.map((i) => (
        <button key={i.id} type="button" onClick={() => jump(i.id)} aria-current={active === i.id ? 'location' : undefined} className={navItemClass(active === i.id)}>
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

/**
 * The same sections as a row of chips stuck to the top of a narrow screen, scrolling sideways; the row slides by itself
 * to keep the marked chip in view. `inBar`: it rides in a sticky bar of the page's own (Settings' save bar).
 */
export function SectionChipNav({ items, label, inBar = false }: { items: NavSection[]; label: string; inBar?: boolean }) {
  const { active, jump } = useActiveSection(items.map((i) => i.id));
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = row.current;
    const chip = nav?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!nav || !chip || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);
  return (
    // edge to edge on the screen, the sections scrolling beneath it on the page's own colour under a hairline
    <nav ref={row} aria-label={label} className={cn('lg:hidden -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 flex gap-1.5 overflow-x-auto whitespace-nowrap', inBar ? 'relative pt-2.5' : 'sticky top-0 z-20 py-2 bg-page border-b border-line')}>
      {items.map((i) => (
        <button key={i.id} type="button" data-section={i.id} onClick={() => jump(i.id)} aria-current={active === i.id ? 'location' : undefined} className={cn(chipClass(active === i.id), 'shrink-0 inline-flex items-center gap-1.5')}>
          <Dot dot={i.dot} />
          {i.label}
          <Status item={i} onAccent={active === i.id} />
        </button>
      ))}
    </nav>
  );
}
