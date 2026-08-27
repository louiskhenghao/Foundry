import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect, useRef, useState } from 'react';

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('w-full rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 disabled:opacity-50', className)} {...props}>
      {children}
    </select>
  );
}

/**
 * Dropdown shell: `trigger` renders the button, `children` the panel (a function receives `close`).
 * Closes on outside click and Escape. Panels are right-aligned by default.
 */
export function Menu({ trigger, children, width = 'w-56', align = 'right', className }: { trigger: (o: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode); width?: string; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && <div className={cn('absolute mt-1 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl p-1.5 z-30 text-xs max-w-[calc(100vw-1.5rem)]', width, align === 'right' ? 'right-0' : 'left-0')}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}

/** Labelled form field: label + optional help line, with room for a trailing badge/action next to the label. */
export function Field({ label, help, aside, children, className }: { label: ReactNode; help?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="flex items-center gap-2 mb-1">
        <span className="text-xs text-zinc-300">{label}</span>
        {aside && <span className="ml-auto flex items-center gap-1.5">{aside}</span>}
      </span>
      {children}
      {help && <span className="block text-[11px] text-zinc-500 mt-1 leading-snug">{help}</span>}
    </label>
  );
}

export function MenuItem({ icon, children, danger, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; danger?: boolean }) {
  return (
    <button className={cn('w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-40 disabled:cursor-not-allowed', danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-zinc-200 hover:bg-zinc-800', className)} {...props}>
      {icon && <span className="shrink-0 text-zinc-400">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function Button({ variant = 'default', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'md' }) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
        variant === 'primary' && 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400',
        variant === 'default' && 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700',
        variant === 'danger' && 'bg-rose-600/20 text-rose-300 border border-rose-700/50 hover:bg-rose-600/30',
        variant === 'ghost' && 'text-zinc-300 hover:bg-zinc-800',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500', className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500', className)} {...props} />;
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-900/60', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-200 min-w-0 flex-1">{title}</h3>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-200',
  clarifying: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  awaiting_brief_approval: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  goal_review: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  blocked: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  done: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  over_delivered: 'bg-emerald-400/30 text-emerald-200 border-emerald-400/60',
  failed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  skipped: 'bg-zinc-700 text-zinc-300 border-zinc-600 line-through decoration-zinc-500',
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
  'ai-engine': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'agents-cli': 'bg-zinc-800 text-zinc-300 border-zinc-700',
  gstack: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  'gstack-copy': 'bg-orange-500/10 text-orange-300/80 border-orange-500/20',
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

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 overflow-x-auto whitespace-nowrap -mx-1 px-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cn('px-3 py-2 text-sm -mb-px border-b-2 flex items-center gap-1.5 shrink-0', value === t.id ? 'border-emerald-500 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200')}>
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/** Page container: consistent max width + responsive padding. */
export function Page({ children, className, width = 'lg' }: { children: ReactNode; className?: string; width?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const max = width === 'sm' ? 'max-w-3xl' : width === 'md' ? 'max-w-4xl' : width === 'lg' ? 'max-w-6xl' : 'max-w-7xl';
  return <div className={cn(max, 'mx-auto p-3 sm:p-4 md:p-6 space-y-4', className)}>{children}</div>;
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button className="text-[11px] text-zinc-400 hover:text-zinc-100 underline decoration-dotted" onClick={() => navigator.clipboard?.writeText(text)} title="copy">
      copy
    </button>
  );
}
export function Badge({ state, children, className }: { state: string; children?: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide border-transparent', STATE_COLORS[state] ?? 'bg-zinc-800 text-zinc-300', className)}>{children ?? state.replace(/_/g, ' ')}</span>;
}

/** Progress bar against a limit; `max` null = no limit (renders a neutral bar). */
export function Meter({ value, max, label, warn }: { value: number; max: number | null; label: string; warn?: boolean }) {
  const unlimited = max == null;
  const pct = unlimited ? 0 : Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="text-xs">
      <div className="flex justify-between text-zinc-400 mb-1">
        <span>{label}</span>
        <span className="mono">{unlimited ? 'no limit' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
        <div className={cn('h-full', unlimited ? 'bg-zinc-600' : warn || pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${unlimited ? 100 : pct}%`, opacity: unlimited ? 0.35 : 1 }} />
      </div>
    </div>
  );
}

/** Modal confirm. Renders nothing when `open` is false. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: { open: boolean; title: ReactNode; children?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {children && <div className="text-xs text-zinc-300 space-y-2">{children}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn('w-full max-h-[92vh] sm:max-h-[85vh] rounded-t-xl sm:rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col', wide ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}>
        <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100 min-w-0 truncate">{title}</h3>
          <button className="ml-auto text-zinc-400 hover:text-zinc-100 text-lg leading-none px-1" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-zinc-500 py-8 text-center">{children}</div>;
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
