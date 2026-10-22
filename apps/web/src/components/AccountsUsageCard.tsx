import type { AccountUsage, AccountWindow } from '@foundry/engine/usage-types';
import { codexQuotaSummary } from '@foundry/engine/quota-windows';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AgentProvider } from '../api.ts';
import { BOARD_ROW, Badge, Card, cn, fmtUsd } from '../ui.tsx';

const SIGNAL: Record<string, { label: string; state: string }> = {
  allowed: { label: 'within limit', state: 'pass' },
  allowed_warning: { label: 'nearing limit', state: 'warn' },
  rejected: { label: 'limit reached', state: 'fail' },
};
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** "in 2h 5m" while it is ahead */
const resetIn = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) - Date.now() : 0;
  if (ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
/** a figure's label: small capitals, as on every page */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint';

/**
 * Each of the coding agent's accounts on the Usage page (ADR-0065): for Claude Code its own window signals and what
 * Foundry spent on it in each window; for Codex its own quota and Foundry's activity on it. A signal is the account's
 * own last report, so an account Foundry has not used yet has none.
 */
export function AccountsUsageCard({ provider, accounts }: { provider: AgentProvider; accounts: AccountUsage[] }) {
  return (
    <Card
      title={<span className="flex items-center gap-2">Accounts <span className="mono text-[13px] tracking-normal text-ink-faint">{accounts.length}</span></span>}
      actions={<Link to="/accounts" className="text-xs font-semibold text-work-ink hover:underline">Manage on Accounts →</Link>}
    >
      {/* the rows run edge to edge: the card's own padding is taken back */}
      <ul className="-m-4 divide-y divide-line" aria-label="Usage per account">
        {accounts.map((a) => (
          <li key={a.id} className={cn(BOARD_ROW, 'grid items-center gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]')}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-bold text-ink" title={a.label}>{a.label}</span>
                {/* the account new sessions run on, marked as the Accounts page marks it: a plate in the accent */}
                {a.current && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-on-accent">
                    <Check size={11} aria-hidden="true" />current
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-ink-faint">
                {[a.plan, a.limitedUntil ? `limited until ${new Date(a.limitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null].filter(Boolean).join(' · ') || ' '}
              </div>
            </div>
            {provider === 'codex' ? (
              <>
                <div className="text-xs"><div className={LABEL}>Account quota</div><div className="mt-1 text-ink">{codexQuotaSummary(a.codexQuota)}</div></div>
                <div className="text-xs"><div className={LABEL}>Foundry · last 7 days</div><div className="mono mt-1 text-ink">{a.sevenDay.sessions} session{a.sevenDay.sessions === 1 ? '' : 's'} · {fmtTokens(a.sevenDay.outputTokens)} output tokens</div></div>
              </>
            ) : (
              <>
                <WindowCell label="5-hour window" w={a.fiveHour} />
                <WindowCell label="7-day window" w={a.sevenDay} />
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WindowCell({ label, w }: { label: string; w: AccountWindow }) {
  const signal = w.status ? (SIGNAL[w.status] ?? { label: w.status.replace(/_/g, ' '), state: 'warn' }) : null;
  const reset = resetIn(w.resetsAt);
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={LABEL}>{label}</span>
        <Badge state={signal?.state ?? 'pending'}>{signal ? signal.label : w.lastSignalAt ? 'no current signal' : 'no signal yet'}</Badge>
        {w.isUsingOverage && <Badge state="warn">overage</Badge>}
      </div>
      <div className="mono mt-1 text-ink">
        {fmtUsd(w.costUsd)} · {w.sessions} session{w.sessions === 1 ? '' : 's'}{reset ? <span className="text-ink-faint"> · resets in {reset}</span> : null}
      </div>
    </div>
  );
}
