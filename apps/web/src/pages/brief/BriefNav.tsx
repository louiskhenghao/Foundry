import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SectionChipNav, SectionSideNav, type NavSection } from '../../components/SectionNav.tsx';
import { chipClass, cn, navItemClass } from '../../ui.tsx';
import { SECTION_STYLE, sectionOfNav } from './shared.ts';

/** a Brief section in its menu; its colour comes from its id ("brief-<section>") */
export type BriefNavItem = Omit<NavSection, 'dot'>;

const withDots = (items: BriefNavItem[]): NavSection[] =>
  items.map((i) => {
    const s = sectionOfNav(i.id);
    return { ...i, dot: s ? SECTION_STYLE[s].dot : undefined };
  });

/**
 * The Brief's sections as a list beside it (wide screens) or a row of tabs above it (narrow ones): click one to jump
 * there; the one you are reading is marked, and each shows its section's colour and how it stands. Both start with the
 * way back to the goal, so it is at hand wherever you have scrolled to (the breadcrumb is at the top of the page).
 */
export function BriefSideNav({ items, goalId }: { items: BriefNavItem[]; goalId: string }) {
  return (
    <SectionSideNav
      items={withDots(items)}
      label="Brief sections"
      lead={
        <Link to={`/goals/${goalId}`} className={cn(navItemClass(false), 'flex items-center gap-2 font-semibold')} title="Back to the goal's run view">
          <ArrowLeft size={14} aria-hidden="true" /> Back to goal
        </Link>
      }
    />
  );
}

export function BriefChipNav({ items, goalId }: { items: BriefNavItem[]; goalId: string }) {
  return (
    <SectionChipNav
      items={withDots(items)}
      label="Brief sections"
      lead={
        // pinned at the row's left edge while the sections slide under it (the row scrolls itself to the marked one). It
        // sticks inside the row's padding, so a strip of the page's colour covers the padding to the screen's edge
        <span className="sticky left-0 z-10 shrink-0 bg-page pr-1.5 shadow-[6px_0_6px_-6px_rgb(0_0_0/0.25)] before:absolute before:inset-y-0 before:right-full before:w-6 before:bg-page">
          <Link to={`/goals/${goalId}`} className={cn(chipClass(false), 'inline-flex items-center gap-1.5')} title="Back to the goal's run view">
            <ArrowLeft size={13} aria-hidden="true" /> Goal
          </Link>
        </span>
      }
    />
  );
}
