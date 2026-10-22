import { SectionChipNav, SectionSideNav, type NavSection } from '../../components/SectionNav.tsx';
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
 * there; the one you are reading is marked, and each shows its section's colour and how it stands.
 */
export function BriefSideNav({ items }: { items: BriefNavItem[] }) {
  return <SectionSideNav items={withDots(items)} label="Brief sections" />;
}

export function BriefChipNav({ items }: { items: BriefNavItem[] }) {
  return <SectionChipNav items={withDots(items)} label="Brief sections" />;
}
