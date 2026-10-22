import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, X, type LucideIcon } from 'lucide-react';

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('w-full min-w-0 rounded-md bg-panel border border-line-strong px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent disabled:opacity-50', className)} {...props}>
      {children}
    </select>
  );
}

/**
 * Dropdown shell: `trigger` renders the button, `children` the panel (a function receives `close`).
 * Closes on outside click and Escape. Panels are right-aligned by default, then kept inside the window: shifted
 * sideways when the aligned edge would push them off screen, opened upwards when there is no room below. They render
 * on <body>, so a panel or card that clips its overflow never cuts them off; Tab still moves from the trigger into the
 * panel and out of it back to the trigger, as if the panel sat right after it.
 */
export function Menu({ trigger, children, width = 'w-56', align = 'right', className }: { trigger: (o: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); width?: string; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const place = () => {
    const t = ref.current?.getBoundingClientRect();
    const p = panel.current;
    if (!t || !p) return;
    const margin = 8;
    const { offsetWidth: w, offsetHeight: h } = p;
    const left = Math.max(margin, Math.min(align === 'right' ? t.right - w : t.left, window.innerWidth - w - margin));
    const below = t.bottom + 4;
    const above = t.top - 4 - h;
    const fitsBelow = below + h <= window.innerHeight - margin;
    // neither side has room: the roomier side, slid back inside the window (the panel is never taller than it)
    const top = fitsBelow ? below : above >= margin ? above : Math.max(margin, Math.min(window.innerHeight - t.bottom > t.top ? below : above, window.innerHeight - h - margin));
    setPos({ top, left });
  };
  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const inside = (n: EventTarget | null) => !!n && (ref.current?.contains(n as Node) || panel.current?.contains(n as Node));
    const onDoc = (e: MouseEvent) => !inside(e.target) && setOpen(false);
    const focusable = () => [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    const back = () => {
      setOpen(false);
      ref.current?.querySelector<HTMLElement>('button, a[href], [tabindex]')?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const at = document.activeElement;
      if (e.key === 'Escape') return panel.current?.contains(at) ? back() : setOpen(false);
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!e.shiftKey && ref.current?.contains(at) && items.length) {
        e.preventDefault();
        items[0]!.focus();
      } else if (panel.current?.contains(at) && (e.shiftKey ? at === items[0] : at === items.at(-1))) {
        e.preventDefault();
        back();
      }
    };
    const onMove = () => place();
    const sized = new ResizeObserver(onMove);
    if (panel.current) sized.observe(panel.current);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      sized.disconnect();
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open &&
        createPortal(
          <div ref={panel} style={pos ?? { top: 0, left: 0, visibility: 'hidden' }} className={cn('fixed rounded-lg border border-line bg-panel shadow-xl p-1.5 z-[65] text-xs max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-auto', width)}>
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Labelled form field: label + optional help line, with room for a trailing badge/action next to the label. */
export function Field({ label, help, aside, children, className }: { label: ReactNode; help?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-ink-soft">{label}</span>
        {aside && <span className="ml-auto flex items-center gap-1.5">{aside}</span>}
      </span>
      {children}
      {help && <span className="block text-[11px] text-ink-faint mt-1 leading-snug">{help}</span>}
    </label>
  );
}

/** `hint`: what the item is for, on a smaller second line under its label (the icon stays with the label) */
export function MenuItem({ icon, children, hint, danger, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; danger?: boolean; hint?: ReactNode }) {
  return (
    <button className={cn('w-full flex gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-40 disabled:cursor-not-allowed', hint ? 'items-start' : 'items-center', danger ? 'text-bad-ink hover:bg-bad/10' : 'text-ink hover:bg-sunken', className)} {...props}>
      {icon && <span className={cn('shrink-0 text-ink-soft', !!hint && 'mt-px')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        {children}
        {hint ? <span className="block mt-0.5 text-[10.5px] leading-snug text-ink-faint">{hint}</span> : null}
      </span>
    </button>
  );
}

type ButtonVariant = 'default' | 'primary' | 'danger' | 'info' | 'ghost';

/**
 * a button's look, for a link that acts as one (an address that opens in a new tab). `lg`: the actions of a page's own head
 * (a goal's), 42px tall in bold.
 */
export function buttonClass(variant: ButtonVariant = 'default', size: 'sm' | 'md' | 'lg' = 'md', className?: string): string {
  return cn(
    'inline-flex items-center transition disabled:opacity-40 disabled:cursor-not-allowed',
    size === 'sm' ? 'gap-1.5 rounded-md font-semibold px-2.5 py-1 text-xs' : size === 'lg' ? 'h-[42px] gap-2 rounded-lg font-bold px-4 text-[14.5px]' : 'gap-1.5 rounded-md font-semibold px-3.5 py-1.5 text-sm',
    variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent/85',
    variant === 'default' && 'bg-panel text-ink hover:bg-line border border-line-strong',
    variant === 'danger' && 'bg-bad/10 text-bad-ink border border-bad/40 hover:bg-bad/20',
    variant === 'info' && 'bg-work/10 text-work-ink border border-work/40 hover:bg-work/20',
    variant === 'ghost' && 'text-ink-soft hover:text-ink hover:bg-line',
    className,
  );
}

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

/**
 * Whether a field may focus itself when it appears (a dialog's first field): only with a mouse at hand. On a touch screen
 * focusing pops the keyboard over what the person came to read, and on iOS zooms the page in.
 */
export const focusFirst: boolean = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('w-full rounded-md bg-panel border border-line-strong px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent disabled:opacity-50', className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('w-full rounded-md bg-panel border border-line-strong px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent', className)} {...props} />;
}

/**
 * A row of mutually exclusive buttons for a short list of choices: every option visible, one click to pick. `lg`: beside
 * the large buttons of a page's own head.
 */
export function ButtonGroup<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; title?: string; /** shown, not choosable (the title says why) */ disabled?: boolean }[]; label: string; size?: 'md' | 'lg' }) {
  return (
    // a segmented control: the chosen option filled with the accent; wrapped buttons grow to fill their row
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-0.5 max-w-full bg-panel ring-1 ring-inset ring-line-strong', size === 'lg' ? 'rounded-lg p-[3px] text-sm' : 'rounded-md p-0.5 text-xs')}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-disabled={o.disabled || undefined}
          title={o.title}
          onClick={() => !o.disabled && onChange(o.id)}
          className={cn('grow whitespace-nowrap', size === 'lg' ? 'h-9 rounded-md px-3.5 font-bold' : 'rounded-sm px-2.5 py-1 font-semibold', o.disabled && 'opacity-40 cursor-not-allowed', value === o.id ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink hover:bg-line')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `onClose` (a card shown as a panel) puts × in the header's top-right corner, where it stays however the actions wrap. */
export function Card({ children, className, bodyClassName, title, actions, id, onClose }: { children: ReactNode; className?: string; bodyClassName?: string; title?: ReactNode; actions?: ReactNode; id?: string; onClose?: () => void }) {
  return (
    <section id={id} className={cn('rounded-lg border border-line bg-panel shadow-[var(--surface-shadow)]', className)}>
      {(title || actions || onClose) && (
        <header className={cn('relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line', onClose && 'pr-12')}>
          <h3 className="text-[12.5px] font-extrabold caps text-ink min-w-0 grow shrink basis-56">{title}</h3>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full ml-auto">{actions}</div>}
          {onClose && (
            <button type="button" className="absolute top-2 right-2 rounded-md p-1.5 text-ink-soft hover:text-ink hover:bg-sunken" onClick={onClose} aria-label="close">
              <X size={15} />
            </button>
          )}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * A state badge's colour: how something stands in its signal (a faint tint behind the word and a ring, so the colour
 * marks it without filling the row), what kind of thing it is in a category colour (a catalog entry's tier, a skill's
 * source, a port's holder), and what has not started or is not known hollow. Literal classes, so Tailwind keeps them.
 */
const SIGNAL_CHIP = {
  you: 'bg-you/20 text-you-ink ring-1 ring-inset ring-you/55',
  work: 'bg-work/12 text-work-ink ring-1 ring-inset ring-work/40',
  ok: 'bg-ok/12 text-ok-ink ring-1 ring-inset ring-ok/40',
  bad: 'bg-bad/10 text-bad-ink ring-1 ring-inset ring-bad/40',
  extra: 'bg-extra/12 text-extra-ink ring-1 ring-inset ring-extra/40',
  hollow: 'text-ink-faint ring-1 ring-inset ring-line-strong',
  quiet: 'bg-sunken text-ink-soft ring-1 ring-inset ring-line',
};
const STATE_COLORS: Record<string, string> = {
  draft: SIGNAL_CHIP.hollow,
  clarifying: SIGNAL_CHIP.work,
  awaiting_brief_approval: SIGNAL_CHIP.you,
  running: SIGNAL_CHIP.work,
  goal_review: SIGNAL_CHIP.extra,
  awaiting_feedback: SIGNAL_CHIP.you,
  blocked: SIGNAL_CHIP.you,
  done: SIGNAL_CHIP.ok,
  over_delivered: SIGNAL_CHIP.ok,
  failed: SIGNAL_CHIP.bad,
  cancelled: SIGNAL_CHIP.hollow,
  pending: SIGNAL_CHIP.hollow,
  ready: SIGNAL_CHIP.work,
  observing: SIGNAL_CHIP.extra,
  merging: SIGNAL_CHIP.extra,
  created: SIGNAL_CHIP.hollow,
  passed: SIGNAL_CHIP.ok,
  error: SIGNAL_CHIP.bad,
  aborted: SIGNAL_CHIP.hollow,
  pass: SIGNAL_CHIP.ok,
  fail: SIGNAL_CHIP.bad,
  skipped: SIGNAL_CHIP.hollow,
  // what an acceptance check or a catalog entry must have, and what is nice to have: kinds, in the hues they had before
  must: 'bg-code-5/12 text-code-5-ink ring-1 ring-inset ring-code-5/45',
  stretch: 'bg-code-4/12 text-code-4-ink ring-1 ring-inset ring-code-4/45',
  open: SIGNAL_CHIP.you,
  answered: SIGNAL_CHIP.ok,
  required: 'bg-code-5/12 text-code-5-ink ring-1 ring-inset ring-code-5/45',
  recommended: 'bg-code-2/12 text-code-2-ink ring-1 ring-inset ring-code-2/45',
  optional: SIGNAL_CHIP.hollow,
  installed: SIGNAL_CHIP.ok,
  'installed-unmanaged': SIGNAL_CHIP.ok,
  'installed-via-plugin': SIGNAL_CHIP.ok,
  partial: SIGNAL_CHIP.you,
  // not there: outlined in red, beside the green of what is installed
  missing: 'text-bad-ink ring-1 ring-inset ring-bad/55',
  duplicate: SIGNAL_CHIP.you,
  // where a skill comes from
  user: 'bg-code-1/12 text-code-1-ink ring-1 ring-inset ring-code-1/45',
  plugin: 'bg-code-3/12 text-code-3-ink ring-1 ring-inset ring-code-3/45',
  project: 'bg-code-7/12 text-code-7-ink ring-1 ring-inset ring-code-7/45',
  'foundry': 'bg-ink/10 text-ink',
  // the Ports page's holders
  tailscale: 'bg-code-1/12 text-code-1-ink ring-1 ring-inset ring-code-1/45',
  docker: 'bg-code-6/12 text-code-6-ink ring-1 ring-inset ring-code-6/45',
  process: SIGNAL_CHIP.quiet,
  'holder-unknown': SIGNAL_CHIP.hollow,
  'agents-cli': SIGNAL_CHIP.quiet,
  manifest: SIGNAL_CHIP.quiet,
  symlink: SIGNAL_CHIP.quiet,
  warn: SIGNAL_CHIP.you,
  // skills sources / update status
  'up-to-date': SIGNAL_CHIP.ok,
  outdated: SIGNAL_CHIP.you,
  modified: SIGNAL_CHIP.work,
  unknown: SIGNAL_CHIP.hollow,
  broken: SIGNAL_CHIP.bad,
  hand: SIGNAL_CHIP.quiet,
  'update-available': SIGNAL_CHIP.you,
};

export function Tabs<T extends string>({ tabs, value, onChange, right }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (t: T) => void; right?: ReactNode }) {
  return (
    // the hairline is an inset shadow, not a border the tabs overlap with -mb-px: that 1px overflow gave the row a vertical scrollbar
    <div className="flex items-center gap-1 shadow-[inset_0_-1px_0_var(--color-line)] overflow-x-auto overflow-y-hidden whitespace-nowrap -mx-1 px-1">
      {tabs.map((t) => (
        // every tab as bold as the chosen one, so choosing one never shifts the row
        <button key={t.id} onClick={() => onChange(t.id)} className={cn('px-3 py-2 text-sm font-semibold border-b-[3px] flex items-center gap-1.5 shrink-0', value === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>
          {t.label}
          {t.badge}
        </button>
      ))}
      {right && <span className="ml-auto shrink-0 pl-2">{right}</span>}
    </div>
  );
}

/** Page container: consistent max width + responsive padding. */
export function Page({ children, className, width = 'lg' }: { children: ReactNode; className?: string; width?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const max = width === 'sm' ? 'max-w-3xl' : width === 'md' ? 'max-w-4xl' : width === 'lg' ? 'max-w-6xl' : 'max-w-7xl';
  return <div className={cn(max, 'mx-auto p-3 sm:p-4 md:p-6 space-y-4', className)}>{children}</div>;
}

/**
 * A page's head, the same on every page: its name in the theme's display font (with an optional "?" to the guide), one
 * line on what it is or where things stand, and its actions on the right. Poster-size type, or a modest line where the
 * theme's header is compact.
 */
export function PageHeader({ title, help, summary, actions, className }: { title: ReactNode; help?: ReactNode; summary?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-4 mb-6 md:mb-8 header-compact:mb-4 header-compact:items-center', className)}>
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[2rem] sm:text-[2.5rem] md:text-5xl font-extrabold leading-none tracking-[-0.035em] text-ink break-words header-compact:text-xl header-compact:font-bold header-compact:tracking-tight">
          {title}
          {help && <span className="font-sans text-base font-normal tracking-normal [&_svg]:h-[18px] [&_svg]:w-[18px]">{help}</span>}
        </h1>
        {summary && <div className="mt-3 max-w-[80ch] text-[15px] leading-relaxed text-ink-faint header-compact:mt-1 header-compact:text-sm">{summary}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** a page's own title where it is not a PageHeader (a goal, a Brief, a session): the theme's display font, poster or compact */
export const PAGE_TITLE = 'font-display text-[1.75rem] sm:text-4xl lg:text-[2.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] break-words header-compact:text-xl header-compact:sm:text-2xl header-compact:font-bold header-compact:tracking-tight';

/** a board's row: hovering it tints it and raises a bar of ink at its left edge */
export const BOARD_ROW = 'group relative transition-colors hover:bg-sunken before:absolute before:inset-y-0 before:left-0 before:w-1 before:origin-top before:scale-y-0 before:bg-ink before:transition-transform hover:before:scale-y-100';
/** a board's row of column labels, when it has columns */
export const BOARD_HEAD = 'border-b border-line bg-sunken px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';

/**
 * A board of rows (goals, sessions, ports…), as on the Goals page: a heading in capitals with its count and a note, then
 * the rows on a panel. `head` is an optional row of column labels (styled with BOARD_HEAD); rows are <li>s, with BOARD_ROW.
 */
export function Board({ id, icon, title, count, note, head, children, className }: { id?: string; icon?: ReactNode; title: ReactNode; count?: ReactNode; note?: ReactNode; head?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('mt-10 first:mt-0', className)}>
      <h2 id={id} className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] font-extrabold caps text-ink">
        {icon}
        {title}
        {count != null && <b className="mono text-[13px] tracking-normal">{count}</b>}
        {note && <span className="w-full sm:w-auto sm:ml-auto text-[13px] font-semibold no-caps text-ink-faint">{note}</span>}
      </h2>
      <div className="overflow-hidden rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),var(--surface-shadow)]">
        {head}
        <ul className="divide-y divide-line">{children}</ul>
      </div>
    </section>
  );
}

/** a filter chip in a row of them (all, by kind…): the chosen one filled with the accent */
export const chipClass = (active: boolean) => cn('rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset transition-colors', active ? 'bg-accent text-on-accent ring-accent' : 'ring-line-strong text-ink-soft hover:text-ink');

/** an option drawn as a card among others (a goal's kind, a delivery mode…): the chosen one outlined in the accent */
export const choiceClass = (selected: boolean) => (selected ? 'border-accent bg-accent/[0.06] shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-line-strong');

/** an item of a page's side list of sections (Settings, the guide, the Brief): the one you are at marked by a bar */
export const navItemClass = (active: boolean) => cn('block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors', active ? 'bg-panel font-bold text-ink shadow-[inset_3px_0_0_var(--color-accent),0_0_0_1px_var(--color-line)]' : 'text-ink-soft hover:bg-panel/70 hover:text-ink');

/**
 * The theme's eight category colours (ADR-0067), for what tells things of a kind apart — the Brief's sections, Areas,
 * extension sources, groups of credits — and never for how something stands (that is the signals: you, work, ok, bad,
 * extra). `ink`: coloured text or an icon on a panel; `dot`: a small fill; `chip`: a tinted tag; `bar`: an edge's colour
 * (give it a width); `fill`: a solid plate with its text; `css`: the colour itself, for an SVG or a style.
 */
export const CODES = [
  { ink: 'text-code-1-ink', dot: 'bg-code-1', chip: 'bg-code-1/12 text-code-1-ink ring-1 ring-inset ring-code-1/45', bar: 'border-code-1', fill: 'bg-code-1 text-on-code-1', css: 'var(--color-code-1)' },
  { ink: 'text-code-2-ink', dot: 'bg-code-2', chip: 'bg-code-2/12 text-code-2-ink ring-1 ring-inset ring-code-2/45', bar: 'border-code-2', fill: 'bg-code-2 text-on-code-2', css: 'var(--color-code-2)' },
  { ink: 'text-code-3-ink', dot: 'bg-code-3', chip: 'bg-code-3/12 text-code-3-ink ring-1 ring-inset ring-code-3/45', bar: 'border-code-3', fill: 'bg-code-3 text-on-code-3', css: 'var(--color-code-3)' },
  { ink: 'text-code-4-ink', dot: 'bg-code-4', chip: 'bg-code-4/12 text-code-4-ink ring-1 ring-inset ring-code-4/45', bar: 'border-code-4', fill: 'bg-code-4 text-on-code-4', css: 'var(--color-code-4)' },
  { ink: 'text-code-5-ink', dot: 'bg-code-5', chip: 'bg-code-5/12 text-code-5-ink ring-1 ring-inset ring-code-5/45', bar: 'border-code-5', fill: 'bg-code-5 text-on-code-5', css: 'var(--color-code-5)' },
  { ink: 'text-code-6-ink', dot: 'bg-code-6', chip: 'bg-code-6/12 text-code-6-ink ring-1 ring-inset ring-code-6/45', bar: 'border-code-6', fill: 'bg-code-6 text-on-code-6', css: 'var(--color-code-6)' },
  { ink: 'text-code-7-ink', dot: 'bg-code-7', chip: 'bg-code-7/12 text-code-7-ink ring-1 ring-inset ring-code-7/45', bar: 'border-code-7', fill: 'bg-code-7 text-on-code-7', css: 'var(--color-code-7)' },
  { ink: 'text-code-8-ink', dot: 'bg-code-8', chip: 'bg-code-8/12 text-code-8-ink ring-1 ring-inset ring-code-8/45', bar: 'border-code-8', fill: 'bg-code-8 text-on-code-8', css: 'var(--color-code-8)' },
] as const;
/** the category colour at place `i`, counting round the eight */
export const code = (i: number) => CODES[((i % CODES.length) + CODES.length) % CODES.length]!;

export function CopyButton({ text }: { text: string }) {
  return (
    <button className="text-[11px] text-ink-soft hover:text-ink underline decoration-dotted" onClick={() => navigator.clipboard?.writeText(text)} title="copy">
      copy
    </button>
  );
}
/** Display names where the raw state is too long for a one-line badge; everything else falls through. */
const STATE_LABELS: Record<string, string> = {
  awaiting_brief_approval: 'approve brief',
  over_delivered: 'over-delivered',
  goal_review: 'reviewing',
  awaiting_feedback: 'have a look',
};
/** a state in words, as a badge or a caption shows it */
export const stateLabel = (state: string) => STATE_LABELS[state] ?? state.replace(/_/g, ' ');
export function Badge({ state, children, className }: { state: string; children?: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] border-transparent', STATE_COLORS[state] ?? SIGNAL_CHIP.quiet, className)} title={state.replace(/_/g, ' ')}>{children ?? stateLabel(state)}</span>;
}

/** Progress bar against a limit; `max` null = no limit (renders a neutral bar). */
/** `note` sits right after the label (an InfoDot): the label stays one line, whatever the note says */
export function Meter({ value, max, label, warn, note }: { value: number; max: number | null; label: string; warn?: boolean; note?: ReactNode }) {
  const unlimited = max == null;
  const pct = unlimited ? 0 : Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between gap-2 text-ink-soft mb-1">
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate">{label}</span>
          {note}
        </span>
        <span className="mono shrink-0 whitespace-nowrap">{unlimited ? 'no limit' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 rounded-xs bg-line overflow-hidden">
        <div className={cn('h-full', unlimited ? 'bg-ink-faint' : warn || pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-you' : 'bg-accent')} style={{ width: `${unlimited ? 100 : pct}%`, opacity: unlimited ? 0.35 : 1 }} />
      </div>
    </div>
  );
}

/**
 * A small dot that says there is more to know about the value beside it: its `label` shows on hover, and a tap or a click
 * opens the panel with `children` (a phone has no hover).
 */
export function InfoDot({ label, children, tone = 'amber' }: { label: string; children: ReactNode; tone?: 'amber' | 'rose' }) {
  return (
    <Menu
      width="w-72"
      align="left"
      trigger={({ open, toggle }) => (
        // 16px in the line (a phone's 32px button height would push the meter's line apart); the ::before is the thumb's target
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={label} title={label} className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-line before:absolute before:-inset-2 before:content-['']" style={{ minHeight: 0 }}>
          <span className={cn('h-2 w-2 rounded-full', tone === 'rose' ? 'bg-bad' : 'bg-you')} />
        </button>
      )}
    >
      <div className="p-2 text-[11px] leading-relaxed text-ink-soft space-y-1.5">{children}</div>
    </Menu>
  );
}

/** Modal confirm. Renders nothing when `open` is false. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger, busy, confirmDisabled, onConfirm, onClose }: { open: boolean; title: ReactNode; children?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; /** the confirm button waits for something in `children` (a box to tick) */ confirmDisabled?: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return (
    // m-0: a parent's space-y gives its children a bottom margin, which shortened this backdrop by as much
    <div className="fixed inset-0 z-50 m-0 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full sm:max-w-md rounded-xl border border-line bg-panel shadow-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {children && <div className="text-xs text-ink-soft space-y-2">{children}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant={danger ? 'danger' : 'primary'} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Simple modal shell. */
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 m-0 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[85vh] rounded-xl border border-line bg-panel shadow-2xl flex flex-col', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}>
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-ink min-w-0 truncate">{title}</h3>
          <button className="ml-auto text-ink-soft hover:text-ink text-lg leading-none px-1" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

/** a page's side panel pinned near the top of the page on a wide screen (see useAffix): <main> starts under the top bar */
export const AFFIX_SIDE = 'lg:sticky lg:top-4 lg:self-start';

/**
 * A page's side panel (Extensions' Catalog, Ports' and Agents' Overview): on a wide screen it stays in view while the list
 * beside it scrolls. One that fits stays right under the top of the page; a taller one scrolls with the page until its end
 * is in view and stays there, so every part of it can be reached without a scroll box of its own (one caught the wheel
 * and cut the panel's content off).
 */
export function useAffix<T extends HTMLElement>(): { ref: (el: T | null) => void; className: string } {
  const stop = useRef<() => void>(() => {});
  // a callback ref: the panel often mounts after the page's first render (once its data is in), so an effect that
  // looked at the ref once on mount would never see it
  const ref = useCallback((el: T | null) => {
    stop.current();
    stop.current = () => {};
    if (!el) return;
    // the page scrolls inside <main>, under the top bar
    const scroller = el.closest('main') ?? document.documentElement;
    const check = () => {
      const room = scroller.clientHeight;
      // taller than the room under its top (lg:top-4) and a margin: it sticks by its end instead, its top that far up
      el.style.top = el.offsetHeight > room - 32 ? `${room - el.offsetHeight - 16}px` : '';
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    stop.current = () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
      el.style.top = '';
    };
  }, []);
  useEffect(() => () => stop.current(), []);
  return { ref, className: AFFIX_SIDE };
}

/** a line while something loads, or why it could not: nothing to show yet, unlike EmptyState's "there is none" */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-ink-faint py-8 text-center">{children}</div>;
}

/** the dots behind an EmptyState's icon, fading out around it: the words under it stay on the plain page */
const EMPTY_FIELD = {
  backgroundImage: 'radial-gradient(var(--color-line-strong) 1px, transparent 1.6px)',
  backgroundSize: '18px 18px',
  backgroundPosition: 'center',
  maskImage: 'radial-gradient(closest-side, black 20%, transparent)',
  WebkitMaskImage: 'radial-gradient(closest-side, black 20%, transparent)',
};

/**
 * What a page, a tab, a board or a card shows when there is nothing in it: the kind's icon on a tile ringed twice in a
 * halo of dots, a heading in the theme's display font, a line on how something comes to be there, and the action that
 * puts it there. `page`: a whole page's or tab's body, framed by a dashed line and tall; `card`: inside a card or a board,
 * which is its frame. `tone`: `ok` where nothing is good news (nothing waits for you), `bad` where the page failed.
 */
export function EmptyState({ icon: Icon, title, children, actions, size = 'page', tone, className }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; actions?: ReactNode; size?: 'page' | 'card'; tone?: 'ok' | 'bad'; className?: string }) {
  const page = size === 'page';
  return (
    <div className={cn('relative isolate flex flex-col items-center justify-center overflow-hidden px-6 text-center', page ? 'min-h-[22rem] rounded-xl border border-dashed border-line-strong py-16' : 'min-h-[15rem] py-12', className)}>
      <span aria-hidden="true" className="relative">
        <span className={cn('pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2', page ? 'h-56 w-[26rem]' : 'h-44 w-80')} style={EMPTY_FIELD} />
        <span className={cn('grid place-items-center rounded-2xl bg-panel shadow-[0_0_0_1px_var(--color-line-strong),0_0_0_10px_var(--color-sunken),0_0_0_11px_var(--color-line)]', page ? 'h-16 w-16' : 'h-14 w-14', tone === 'ok' ? 'text-ok-ink' : tone === 'bad' ? 'text-bad-ink' : 'text-ink-soft')}>
          <Icon size={page ? 28 : 24} strokeWidth={1.75} />
        </span>
      </span>
      <h3 className={cn('font-display font-extrabold tracking-[-0.02em] text-ink text-balance', page ? 'mt-8 text-2xl sm:text-[1.75rem] leading-tight' : 'mt-7 text-xl leading-snug')}>{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm leading-relaxed text-ink-faint text-pretty">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** how long ago, in the fewest words: 40 s, 7 min, 3 h, 2 d */
export function waited(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

/** the frame of what waits for you: a panel whose head is a YouStrip */
export const NEEDS_YOU_CARD = 'overflow-hidden rounded-lg bg-panel shadow-[0_0_0_1px_var(--color-line),var(--surface-shadow)]';

/**
 * The head of what waits for you (an Inbox item, a milestone to look at, a round of questions, a Brief to approve), a
 * strip in the yellow of the Goals page's signs: the kind's icon, the action in its largest words, how long it has
 * waited and where it leads; the details and the controls go on the panel under it. `quiet` once it no longer waits
 * (an answered item): the same head, without the yellow. A theme whose signs are cards keeps the panel and draws the
 * yellow as its left edge, the icon's tile and the waiting chip (signs-card:).
 */
export function YouStrip({ icon: Icon, title, tags, since, aside, children, quiet = false }: {
  icon: LucideIcon;
  title: ReactNode;
  /** after the title, in its line: small plates, a "?" to the guide */
  tags?: ReactNode;
  /** when it began to wait: a "waiting 7 min" chip */
  since?: string | null;
  /** its links or its button, at the end of the strip (under the rest on a phone) */
  aside?: ReactNode;
  /** lines under the title */
  children?: ReactNode;
  quiet?: boolean;
}) {
  const waiting = quiet ? null : since;
  return (
    <header className={cn('grid grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 sm:gap-x-4 gap-y-2.5 px-4 py-3.5 sm:px-5 sm:py-4', quiet ? 'border-b border-line' : 'bg-you text-on-you signs-card:border-b signs-card:border-line signs-card:bg-panel signs-card:text-ink signs-card:shadow-[inset_5px_0_0_var(--color-you)]')}>
      <span className={cn('grid h-9 w-9 sm:h-11 sm:w-11 place-items-center rounded-lg', quiet ? 'bg-ok/12 text-ok-ink ring-[1.5px] ring-inset ring-ok/45' : 'bg-on-you text-you signs-card:bg-you signs-card:text-on-you')} aria-hidden="true">
        <Icon size={18} strokeWidth={2.25} className="sm:h-[22px] sm:w-[22px]" />
      </span>
      <div className="min-w-0 self-center">
        <h3 className={cn('min-w-0 font-extrabold leading-tight tracking-[-0.02em] break-words', quiet ? 'text-lg sm:text-xl text-ink-soft' : 'text-xl sm:text-2xl')}>
          {title}
          {/* in the title's line, after its last word: a long title that wraps keeps its "?" with it, never alone on a line
              of its own. A "?" link to the guide reads in the strip's ink */}
          {tags && <span className={cn('ml-2.5 inline-flex flex-wrap items-center gap-1.5 align-middle', !quiet && '[&_a]:text-on-you/60 [&_a:hover]:text-on-you signs-card:[&_a]:text-ink-faint signs-card:[&_a:hover]:text-ink')}>{tags}</span>}
        </h3>
        {children}
      </div>
      {(waiting || aside) && (
        <div className="col-start-2 sm:col-start-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-col sm:items-end">
          {waiting && (
            <span className="mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-on-you px-2 py-1 text-[12.5px] font-bold text-you signs-card:bg-you signs-card:text-on-you" title={new Date(waiting).toLocaleString()}>
              <Clock size={13} aria-hidden="true" />
              waiting {waited(waiting)}
            </span>
          )}
          {aside}
        </div>
      )}
    </header>
  );
}

export const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
/** A budget limit: null means unlimited. */
export const fmtLimitUsd = (n: number | null) => (n == null ? '∞' : fmtUsd(n));
export const fmtLimitMin = (n: number | null) => (n == null ? '∞' : `${n} min`);
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
