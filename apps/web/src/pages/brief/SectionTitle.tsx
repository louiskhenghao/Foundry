import type { ReactNode } from 'react';
import { cn } from '../../ui.tsx';
import { type BriefSection, SECTION_STYLE } from './shared.ts';

/** a card title on the Brief page: the section's icon in its colour, then the words, in the case of the card's head */
export function SectionTitle({ section, children, className }: { section: BriefSection; children: ReactNode; className?: string }) {
  const { Icon, ink } = SECTION_STYLE[section];
  return (
    <span className={cn('inline-flex items-center gap-2 caps', className)}>
      <Icon size={14} strokeWidth={2.25} className={cn('shrink-0', ink)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
