import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * The way back from a page that belongs to a goal (its Brief, a merge resolved by hand): a bar stuck to the top of the
 * page with the goal's name, at hand however far down the page you are — on a phone too, where the breadcrumb had
 * scrolled away and the Brief's own menu began under the whole header. Its parent must be the page's own box: a
 * sticky bar never leaves the box it is in.
 */
export function BackBar({ to, label = 'Back to goal', title }: { to: string; label?: string; /** the goal's name, cut short to the room there is */ title: string }) {
  return (
    <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 md:-mx-6 flex h-9 items-center gap-2 border-b border-line bg-page/85 px-3 text-sm backdrop-blur-md sm:px-4 md:px-6">
      <Link to={to} className="inline-flex shrink-0 items-center gap-1.5 font-bold text-ink hover:underline underline-offset-[3px]">
        <ArrowLeft size={14} aria-hidden="true" /> {label}
      </Link>
      <span aria-hidden="true" className="text-ink-faint">·</span>
      <span className="min-w-0 truncate text-ink-soft" title={title}>
        {title}
      </span>
      <Link to="/" className="ml-auto shrink-0 text-ink-faint hover:text-ink hover:underline underline-offset-[3px]">
        Goals
      </Link>
    </div>
  );
}
