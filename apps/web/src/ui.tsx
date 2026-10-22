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
      {help && <span className="block text-[11px] text-zinc-500 mt-1 leading-snug">{help}</span>}
    </label>
  );
}

/** `hint`: what the item is for, on a smaller second line under its label (the icon stays with the label) */
export function MenuItem({ icon, children, hint, danger, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; danger?: boolean; hint?: ReactNode }) {
  return (
    <button className={cn('w-full flex gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-40 disabled:cursor-not-allowed', hint ? 'items-start' : 'items-center', danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-zinc-200 hover:bg-zinc-800', className)} {...props}>
      {icon && <span className={cn('shrink-0 text-zinc-400', !!hint && 'mt-px')}>{icon}</span>}
      <span className="min-w-0 flex-1">
        {children}
        {hint ? <span className="block mt-0.5 text-[10px] leading-snug text-zinc-500">{hint}</span> : null}
      </span>
    </button>
  );
}

type ButtonVariant = 'default' | 'primary' | 'danger' | 'info' | 'ghost';

/** a button's look, for a link that acts as one (an address that opens in a new tab) */
export function buttonClass(variant: ButtonVariant = 'default', size: 'sm' | 'md' = 'md', className?: string): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed',
    size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
    variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent/85',
    variant === 'default' && 'bg-panel text-ink hover:bg-zinc-800 border border-line-strong',
    variant === 'danger' && 'bg-rose-600/20 text-rose-300 border border-rose-700/50 hover:bg-rose-600/30',
    variant === 'info' && 'bg-sky-600/20 text-sky-300 border border-sky-700/50 hover:bg-sky-600/30',
    variant === 'ghost' && 'text-ink-soft hover:text-ink hover:bg-zinc-800',
    className,
  );
}

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
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

/** A row of mutually exclusive buttons for a short list of choices: every option visible, one click to pick. */
export function ButtonGroup<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; title?: string; /** shown, not choosable (the title says why) */ disabled?: boolean }[]; label: string }) {
  return (
    // a segmented control: the chosen option filled with the accent; wrapped buttons grow to fill their row
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 max-w-full rounded-md p-0.5 bg-panel ring-1 ring-inset ring-line-strong text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-disabled={o.disabled || undefined}
          title={o.title}
          onClick={() => !o.disabled && onChange(o.id)}
          className={cn('grow rounded-sm px-2.5 py-1 whitespace-nowrap font-semibold', o.disabled && 'opacity-40 cursor-not-allowed', value === o.id ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink hover:bg-zinc-800')}
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
    <section id={id} className={cn('rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.05)]', className)}>
      {(title || actions || onClose) && (
        <header className={cn('relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line', onClose && 'pr-12')}>
          <h3 className="text-[12.5px] font-extrabold uppercase tracking-[0.1em] text-ink min-w-0 grow shrink basis-56">{title}</h3>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full ml-auto">{actions}</div>}
          {onClose && (
            <button type="button" className="absolute top-2 right-2 rounded p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800" onClick={onClose} aria-label="close">
              <X size={15} />
            </button>
          )}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-200',
  clarifying: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  awaiting_brief_approval: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  goal_review: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  awaiting_feedback: 'bg-amber-400/25 text-amber-200 border-amber-400/50',
  blocked: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  done: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  over_delivered: 'bg-emerald-400/30 text-emerald-200 border-emerald-400/60',
  failed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  cancelled: 'bg-zinc-700 text-zinc-400',
  pending: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  ready: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  observing: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  merging: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
  created: 'bg-zinc-800 text-zinc-400',
  passed: 'bg-emerald-500/20 text-emerald-300',
  error: 'bg-rose-500/20 text-rose-300',
  aborted: 'bg-zinc-700 text-zinc-400',
  pass: 'bg-emerald-500/20 text-emerald-300',
  fail: 'bg-rose-500/20 text-rose-300',
  skipped: 'bg-zinc-700 text-zinc-400',
  must: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  stretch: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  open: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  answered: 'bg-zinc-700 text-zinc-300',
  required: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  recommended: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  optional: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  installed: 'bg-emerald-500/20 text-emerald-300',
  'installed-unmanaged': 'bg-emerald-500/10 text-emerald-400',
  'installed-via-plugin': 'bg-emerald-500/10 text-emerald-400',
  partial: 'bg-amber-500/20 text-amber-300',
  missing: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  duplicate: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  user: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  plugin: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  project: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  'foundry': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  // the Ports page's holders
  tailscale: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  docker: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  process: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'holder-unknown': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'agents-cli': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  manifest: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  symlink: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  warn: 'bg-amber-500/20 text-amber-300',
  // skills sources / update status
  'up-to-date': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  outdated: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  modified: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  unknown: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  broken: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  hand: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  'update-available': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
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
 * A page's head, the same on every page: its name in large type (with an optional "?" to the guide), one line on what it
 * is or where things stand, and its actions on the right.
 */
export function PageHeader({ title, help, summary, actions, className }: { title: ReactNode; help?: ReactNode; summary?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-4 mb-6 md:mb-8', className)}>
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[2rem] sm:text-[2.5rem] md:text-5xl font-extrabold leading-none tracking-[-0.035em] text-ink break-words">
          {title}
          {help && <span className="text-base font-normal tracking-normal [&_svg]:h-[18px] [&_svg]:w-[18px]">{help}</span>}
        </h1>
        {summary && <div className="mt-3 max-w-[80ch] text-[15px] leading-relaxed text-ink-faint">{summary}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** a board's row: hovering it tints it and raises a bar of ink at its left edge */
export const BOARD_ROW = 'group relative transition-colors hover:bg-inset before:absolute before:inset-y-0 before:left-0 before:w-1 before:origin-top before:scale-y-0 before:bg-ink before:transition-transform hover:before:scale-y-100';
/** a board's row of column labels, when it has columns */
export const BOARD_HEAD = 'border-b border-line bg-inset px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint';

/**
 * A board of rows (goals, sessions, ports…), as on the Goals page: a heading in capitals with its count and a note, then
 * the rows on a panel. `head` is an optional row of column labels (styled with BOARD_HEAD); rows are <li>s, with BOARD_ROW.
 */
export function Board({ id, icon, title, count, note, head, children, className }: { id?: string; icon?: ReactNode; title: ReactNode; count?: ReactNode; note?: ReactNode; head?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('mt-10 first:mt-0', className)}>
      <h2 id={id} className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] font-extrabold uppercase tracking-[0.12em] text-ink">
        {icon}
        {title}
        {count != null && <b className="mono text-[13px] tracking-normal">{count}</b>}
        {note && <span className="w-full sm:w-auto sm:ml-auto text-[13px] font-semibold normal-case tracking-normal text-ink-faint">{note}</span>}
      </h2>
      <div className="overflow-hidden rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]">
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

export function CopyButton({ text }: { text: string }) {
  return (
    <button className="text-[11px] text-zinc-400 hover:text-zinc-100 underline decoration-dotted" onClick={() => navigator.clipboard?.writeText(text)} title="copy">
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
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] border-transparent', STATE_COLORS[state] ?? 'bg-zinc-800 text-zinc-300', className)} title={state.replace(/_/g, ' ')}>{children ?? stateLabel(state)}</span>;
}

/** Progress bar against a limit; `max` null = no limit (renders a neutral bar). */
/** `note` sits right after the label (an InfoDot): the label stays one line, whatever the note says */
export function Meter({ value, max, label, warn, note }: { value: number; max: number | null; label: string; warn?: boolean; note?: ReactNode }) {
  const unlimited = max == null;
  const pct = unlimited ? 0 : Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between gap-2 text-zinc-400 mb-1">
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate">{label}</span>
          {note}
        </span>
        <span className="mono shrink-0 whitespace-nowrap">{unlimited ? 'no limit' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 rounded-xs bg-line overflow-hidden">
        <div className={cn('h-full', unlimited ? 'bg-zinc-600' : warn || pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-you' : 'bg-accent')} style={{ width: `${unlimited ? 100 : pct}%`, opacity: unlimited ? 0.35 : 1 }} />
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
        <button type="button" onClick={toggle} aria-expanded={open} aria-label={label} title={label} className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-zinc-800 before:absolute before:-inset-2 before:content-['']" style={{ minHeight: 0 }}>
          <span className={cn('h-2 w-2 rounded-full', tone === 'rose' ? 'bg-bad' : 'bg-you')} />
        </button>
      )}
    >
      <div className="p-2 text-[11px] leading-relaxed text-zinc-300 space-y-1.5">{children}</div>
    </Menu>
  );
}

/** Modal confirm. Renders nothing when `open` is false. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger, busy, confirmDisabled, onConfirm, onClose }: { open: boolean; title: ReactNode; children?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; /** the confirm button waits for something in `children` (a box to tick) */ confirmDisabled?: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full sm:max-w-md rounded-xl border border-line bg-panel shadow-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {children && <div className="text-xs text-zinc-300 space-y-2">{children}</div>}
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[85vh] rounded-xl border border-line bg-panel shadow-2xl flex flex-col', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}>
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <h3 className="text-sm font-bold text-ink min-w-0 truncate">{title}</h3>
          <button className="ml-auto text-zinc-400 hover:text-zinc-100 text-lg leading-none px-1" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

/** a page's side panel pinned under the top bar on a wide screen (see useAffix) */
export const AFFIX_SIDE = 'lg:sticky lg:top-14 lg:self-start';

/**
 * A page's side panel (Extensions' Catalog, Ports' and Agents' Overview): on a wide screen it stays in view right under
 * the top bar while the list beside it scrolls — as long as it fits under the bar. A taller panel scrolls with the page
 * instead: pinning it would hide its end, and an inner scroll box of its own caught the wheel and cut its content off.
 */
export function useAffix<T extends HTMLElement>(): { ref: (el: T | null) => void; className: string } {
  const [fits, setFits] = useState(true);
  const stop = useRef<() => void>(() => {});
  // a callback ref: the panel often mounts after the page's first render (once its data is in), so an effect that
  // looked at the ref once on mount would never see it
  const ref = useCallback((el: T | null) => {
    stop.current();
    stop.current = () => {};
    if (!el) return;
    const check = () => setFits(el.offsetHeight <= window.innerHeight - 64);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    stop.current = () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);
  useEffect(() => () => stop.current(), []);
  return { ref, className: fits ? AFFIX_SIDE : 'lg:self-start' };
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-zinc-500 py-8 text-center">{children}</div>;
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
export const NEEDS_YOU_CARD = 'overflow-hidden rounded-lg bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]';

/**
 * The head of what waits for you (an Inbox item, a milestone to look at, a round of questions, a Brief to approve), a
 * strip in the yellow of the Goals page's signs: the kind's icon, the action in its largest words, how long it has
 * waited and where it leads; the details and the controls go on the panel under it. `quiet` once it no longer waits
 * (an answered item): the same head, without the yellow.
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
    <header className={cn('grid grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] items-start gap-x-3 sm:gap-x-4 gap-y-2.5 px-4 py-3.5 sm:px-5 sm:py-4', quiet ? 'border-b border-line' : 'bg-you text-on-you')}>
      <span className={cn('grid h-9 w-9 sm:h-11 sm:w-11 place-items-center rounded-lg', quiet ? 'ring-[1.5px] ring-inset ring-line-strong text-ink-soft' : 'bg-on-you text-you')} aria-hidden="true">
        <Icon size={18} strokeWidth={2.25} className="sm:h-[22px] sm:w-[22px]" />
      </span>
      <div className="min-w-0 self-center">
        <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={cn('min-w-0 font-extrabold leading-tight tracking-[-0.02em] break-words', quiet ? 'text-lg sm:text-xl text-ink-soft' : 'text-xl sm:text-2xl')}>{title}</span>
          {/* a "?" link to the guide reads in the strip's ink */}
          {tags && <span className={cn('flex flex-wrap items-center gap-1.5', !quiet && '[&_a]:text-on-you/60 [&_a:hover]:text-on-you')}>{tags}</span>}
        </h3>
        {children}
      </div>
      {(waiting || aside) && (
        <div className="col-start-2 sm:col-start-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:flex-col sm:items-end">
          {waiting && (
            <span className="mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-on-you px-2 py-1 text-[12.5px] font-bold text-you" title={new Date(waiting).toLocaleString()}>
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
