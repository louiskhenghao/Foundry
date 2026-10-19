import type { ReactNode } from 'react';
import { cn } from '../../ui.tsx';
import { type BriefSection, SECTION_STYLE } from './shared.ts';

/** a card title on the Brief page: the section's icon in its hue, then the words */
export function SectionTitle({ section, children, className }: { section: BriefSection; children: ReactNode; className?: string }) {
  const { Icon, text } = SECTION_STYLE[section];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Icon size={15} className={cn('shrink-0', text)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
