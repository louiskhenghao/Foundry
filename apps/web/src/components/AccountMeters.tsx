import { fmtReset, meterLevel, readingAge, resetIn, type AccountMeter, type AccountMeters, type ReadingAge } from '@foundry/engine/account-meters';
import { ago, cn } from '../ui.tsx';

/** the bar by how far the window is used: the work blue (information from the account), amber from half, red near the end; the same for every coding agent */
const BAR: Record<string, string> = { ok: 'bg-work', warn: 'bg-you', bad: 'bg-bad', unknown: 'bg-line' };
const FIGURE: Record<string, string> = { ok: 'text-ink', warn: 'text-you-ink', bad: 'text-bad-ink', unknown: 'text-ink-faint' };
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 && n > 0 ? 1 : 0 })}%`);
/** a reading kept through failed reads, coloured by its age (ADR-0099): plain under ten minutes, amber under an hour, red after */
const AGE: Record<ReadingAge, string> = { fresh: 'text-ink-faint', aging: 'text-you-ink', old: 'text-bad-ink' };

/**
 * When the reading was taken. When the account could not be read since, the bars show the last reading that succeeded
 * (ADR-0099), and this line says so in the colour of the reading's age: when it was tried again and why that failed.
 * `onlyStale` keeps the line off a row whose reading is current; `action` says how to read again (Refresh status).
 */
export function ReadingNote({ meters, action, onlyStale = false, className }: { meters: AccountMeters; action?: string; onlyStale?: boolean; className?: string }) {
  if (meters.state !== 'available' || (onlyStale && !meters.stale)) return null;
  const age = meters.stale ? readingAge(meters.checkedAt) : 'fresh';
  return (
    <p className={cn('text-[11px]', AGE[age], className)}>
      <span className={cn(meters.stale && 'font-semibold')}>Usage as of {ago(meters.checkedAt)}</span>
      {meters.stale && (
        <>
          {' '}
          · the last reading that could be taken; tried again {ago(meters.stale.triedAt)}: <span className="[overflow-wrap:anywhere]">{meters.stale.message}</span>
        </>
      )}
      {action && <span className="text-ink-faint"> · {action}</span>}
    </p>
  );
}

/**
 * One account's usage windows as bars (ADR-0090): compact on a row (a thin bar per window with its figure), or expanded
 * into cards for the current account, each with its reset time. The same component on the Accounts page and on the
 * Usage page's Accounts card, for every coding agent; what cannot be read stays a sentence, never an empty bar.
 */
export function AccountMeterBars({ meters, expanded = false, className }: { meters: AccountMeters; expanded?: boolean; className?: string }) {
  if (meters.state === 'unread') return <p className={cn('text-xs text-ink-faint', className)}>Usage not read yet.</p>;
  if (meters.state !== 'available')
    return (
      <p className={cn('text-xs text-ink-faint', className)}>
        Usage unavailable <span className="[overflow-wrap:anywhere]">· {meters.message}</span>
      </p>
    );
  if (!meters.meters.length) return <p className={cn('text-xs text-ink-faint', className)}>No usage window reported.</p>;
  return (
    <div className={cn('space-y-1.5', className)}>
      {expanded ? (
        <div className={cn('grid gap-2', meters.meters.length > 1 && 'sm:grid-cols-2', meters.meters.length > 2 && 'lg:grid-cols-3')}>
          {meters.meters.map((m) => <MeterCard key={m.id} m={m} />)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">{meters.meters.map((m) => <MeterLine key={m.id} m={m} />)}</div>
      )}
      {meters.note && <p className="text-[11px] font-semibold text-you-ink">{meters.note}</p>}
    </div>
  );
}

function Bar({ m, className }: { m: AccountMeter; className?: string }) {
  const known = m.usedPercent != null;
  return (
    <div className={cn('overflow-hidden rounded-xs bg-line', className)} role={known ? 'meter' : undefined} aria-label={`${m.title} · ${m.window}${known ? '' : ' unknown'}`} aria-valuemin={known ? 0 : undefined} aria-valuemax={known ? 100 : undefined} aria-valuenow={m.usedPercent ?? undefined} aria-valuetext={known ? `${pct(m.usedPercent)} used` : 'unknown'}>
      <div className={cn('h-full', BAR[meterLevel(m.usedPercent)])} style={{ width: `${m.usedPercent ?? 0}%` }} />
    </div>
  );
}

/** a thin bar with the figure: what an account's row shows; the window, the reset and a note on hover */
function MeterLine({ m }: { m: AccountMeter }) {
  const soon = resetIn(m.resetsAt);
  return (
    <div className="min-w-[7.5rem] grow basis-32 text-[11px]" title={[m.window, m.note, fmtReset(m.resetsAt), soon && `(${soon})`].filter(Boolean).join(' · ')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-ink-soft">{m.title}</span>
        <span className={cn('mono font-bold', FIGURE[meterLevel(m.usedPercent)])}>{pct(m.usedPercent)}</span>
      </div>
      <Bar m={m} className="mt-0.5 h-1" />
    </div>
  );
}

/** a card as the menu-bar app draws one: the title, the window, the figure in its colour, the bar, when it resets */
function MeterCard({ m }: { m: AccountMeter }) {
  const soon = resetIn(m.resetsAt);
  return (
    <section className="min-w-0 rounded-lg border border-line bg-sunken px-3 py-2.5" aria-label={`${m.title} · ${m.window}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-bold text-ink">{m.title}</h4>
          <p className="text-[11px] text-ink-faint">{m.window}</p>
        </div>
        <span className={cn('mono shrink-0 text-base font-extrabold leading-none', FIGURE[meterLevel(m.usedPercent)])}>{pct(m.usedPercent)}</span>
      </div>
      <Bar m={m} className="mt-2 h-1.5" />
      <p className="mt-1.5 text-[11px] text-ink-faint" title={soon ?? undefined}>{m.note ?? fmtReset(m.resetsAt) ?? (m.usedPercent == null ? 'Usage unknown' : 'Reset time not reported')}</p>
    </section>
  );
}
