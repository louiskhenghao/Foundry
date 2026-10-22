import { cn } from '../../ui.tsx';

export const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * Context-window usage bar. The denominator is a hardcoded model→window guess, so raw tokens stay visible. A thin bar of
 * ink like every meter's, red past 90 %: a filling window asks nothing of the person (the agent compacts it), so it
 * never turns the yellow of what waits for them.
 */
export function ContextGauge({ used, window: win, className }: { used: number | null; window: number | null; className?: string }) {
  if (used == null) return null;
  const pct = win ? Math.min(100, (used / win) * 100) : 0;
  const tone = pct > 90 ? 'bg-bad' : 'bg-ink';
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={win ? `${used.toLocaleString()} of ~${win.toLocaleString()} tokens in context` : `${used.toLocaleString()} tokens in context`}>
      {win != null && (
        <span className="h-1 w-14 rounded-xs bg-line overflow-hidden shrink-0">
          <span className={cn('block h-full rounded-xs', tone)} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="mono text-[11px] text-ink-soft whitespace-nowrap">
        {fmtTokens(used)}
        {win != null && <span className="text-ink-faint"> / {fmtTokens(win)}</span>}
      </span>
    </span>
  );
}
