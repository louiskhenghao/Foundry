import type { ReactNode } from 'react';
import { cn } from '../../ui.tsx';
import { type BriefSection, SECTION_STYLE } from './shared.ts';

/** a card title on the Brief page: the section's icon, then the words, in the capitals of the card's head (as "WORKING 2" on the Goals page) */
export function SectionTitle({ section, children, className }: { section: BriefSection; children: ReactNode; className?: string }) {
  const { Icon } = SECTION_STYLE[section];
  return (
    <span className={cn('inline-flex items-center gap-2 uppercase', className)}>
      <Icon size={14} strokeWidth={2.25} className="shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
