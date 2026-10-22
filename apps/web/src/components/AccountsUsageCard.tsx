import type { AccountUsage, AccountWindow } from '@foundry/engine/usage-types';
import { codexQuotaSummary } from '@foundry/engine/quota-windows';
import { Link } from 'react-router-dom';
import type { AgentProvider } from '../api.ts';
import { Badge, Card, fmtUsd } from '../ui.tsx';

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

/**
 * Each of the coding agent's accounts on the Usage page (ADR-0065): for Claude Code its own window signals and what
 * Foundry spent on it in each window; for Codex its own quota and Foundry's activity on it. A signal is the account's
 * own last report, so an account Foundry has not used yet has none.
 */
export function AccountsUsageCard({ provider, accounts }: { provider: AgentProvider; accounts: AccountUsage[] }) {
  return (
    <Card
      title={<span className="flex items-center gap-2">Accounts <span className="tabular-nums text-xs font-normal text-zinc-500">{accounts.length}</span></span>}
      actions={<Link to="/accounts" className="text-[11px] text-emerald-400 hover:underline">Manage on Accounts →</Link>}
    >
      {/* the rows run edge to edge: the card's own padding is taken back */}
      <ul className="-m-4 divide-y divide-zinc-800" aria-label="Usage per account">
        {accounts.map((a) => (
          <li key={a.id} className="grid items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm text-zinc-100" title={a.label}>{a.label}</span>
                {a.current && <Badge state="pass">current</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {[a.plan, a.limitedUntil ? `limited until ${new Date(a.limitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null].filter(Boolean).join(' · ') || ' '}
              </div>
            </div>
            {provider === 'codex' ? (
              <>
                <div className="text-xs"><div className="text-zinc-500">Account quota</div><div className="mt-0.5 text-zinc-200">{codexQuotaSummary(a.codexQuota)}</div></div>
                <div className="text-xs"><div className="text-zinc-500">Foundry · last 7 days</div><div className="mt-0.5 tabular-nums text-zinc-200">{a.sevenDay.sessions} session{a.sevenDay.sessions === 1 ? '' : 's'} · {fmtTokens(a.sevenDay.outputTokens)} output tokens</div></div>
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
        <span className="text-zinc-500">{label}</span>
        <Badge state={signal?.state ?? 'pending'}>{signal ? signal.label : w.lastSignalAt ? 'no current signal' : 'no signal yet'}</Badge>
        {w.isUsingOverage && <Badge state="warn">overage</Badge>}
      </div>
      <div className="mt-1 tabular-nums text-zinc-300">
        {fmtUsd(w.costUsd)} · {w.sessions} session{w.sessions === 1 ? '' : 's'}{reset ? <span className="text-zinc-500"> · resets in {reset}</span> : null}
      </div>
    </div>
  );
}
