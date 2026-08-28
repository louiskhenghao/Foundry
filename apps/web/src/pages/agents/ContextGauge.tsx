import { cn } from '../../ui.tsx';

export const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Context-window usage bar. The denominator is a hardcoded model→window guess, so raw tokens stay visible. */
export function ContextGauge({ used, window: win, className }: { used: number | null; window: number | null; className?: string }) {
  if (used == null) return null;
  const pct = win ? Math.min(100, (used / win) * 100) : 0;
  const tone = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={win ? `${used.toLocaleString()} of ~${win.toLocaleString()} tokens in context` : `${used.toLocaleString()} tokens in context`}>
      {win != null && (
        <span className="h-1.5 w-14 rounded-full bg-zinc-800 overflow-hidden shrink-0">
          <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="mono text-[11px] text-zinc-400 whitespace-nowrap">
        {fmtTokens(used)}
        {win != null && <span className="text-zinc-600"> / {fmtTokens(win)}</span>}
      </span>
    </span>
  );
}
