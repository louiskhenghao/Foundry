import { claudeMeters, codexMeters, resetIn } from '@foundry/engine/account-meters';
import type { AccountUsage, AccountWindow } from '@foundry/engine/usage-types';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AgentProvider } from '../api.ts';
import { BOARD_ROW, Badge, Card, ago, cn, fmtUsd } from '../ui.tsx';
import { AccountMeterBars } from './AccountMeters.tsx';

const SIGNAL: Record<string, { label: string; state: string }> = {
  allowed: { label: 'within limit', state: 'pass' },
  allowed_warning: { label: 'nearing limit', state: 'warn' },
  rejected: { label: 'limit reached', state: 'fail' },
};
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
/** a figure's label: small capitals, as on every page */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';

/**
 * Each of the coding agent's accounts on the Usage page (ADR-0065): its own usage windows as the coding agent reports
 * them, the bars of the Accounts page (ADR-0090), and under them Foundry's own activity on the account — for Claude Code
 * what it spent in each window and the last signal its sessions carried, for Codex its sessions and tokens.
 */
export function AccountsUsageCard({ provider, accounts }: { provider: AgentProvider; accounts: AccountUsage[] }) {
  return (
    <Card
      title={<span className="flex items-center gap-2">Accounts <span className="mono text-[13px] tracking-normal text-ink-faint">{accounts.length}</span></span>}
      actions={<Link to="/accounts" className="inline-flex items-center text-xs font-semibold text-work-ink hover:underline max-sm:min-h-8">Manage on Accounts →</Link>}
    >
      {/* the rows run edge to edge: the card's own padding is taken back */}
      <ul className="-m-4 divide-y divide-line" aria-label="Usage per account">
        {accounts.map((a) => {
          const usage = provider === 'codex' ? codexMeters(a.codexQuota) : claudeMeters(a.claudeUsage);
          return (
            <li key={a.id} className={cn(BOARD_ROW, 'grid items-start gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]')}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-ink" title={a.label}>{a.label}</span>
                  {/* the account new sessions run on, marked as the Accounts page marks it: a plate in the ok green */}
                  {a.current && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-ok px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-on-ok">
                      <Check size={11} aria-hidden="true" />current
                    </span>
                  )}
                </div>
                {/* a reached limit in red words, as "limit reached" beside it */}
                <div className="mt-0.5 text-xs text-ink-faint">
                  {a.plan}
                  {a.plan && a.limitedUntil ? ' · ' : null}
                  {a.limitedUntil ? <span className="font-semibold text-bad-ink">limited until {new Date(a.limitedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
                  {!a.plan && !a.limitedUntil ? ' ' : null}
                </div>
                {usage.state !== 'unread' && <div className="mt-1 text-[11px] text-ink-faint">usage as of {ago(usage.checkedAt)}</div>}
              </div>
              <div className="min-w-0 space-y-2">
                <AccountMeterBars meters={usage} expanded={a.current} />
                {provider === 'codex' ? (
                  <div className="text-xs">
                    <span className={LABEL}>Foundry · last 7 days</span> <span className="mono text-ink">{a.sevenDay.sessions} session{a.sevenDay.sessions === 1 ? '' : 's'} · {fmtTokens(a.sevenDay.outputTokens)} output tokens</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className={LABEL}>Foundry</span>
                    <Spent label="5-hour" w={a.fiveHour} />
                    <Spent label="7-day" w={a.sevenDay} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** what Foundry spent on the account in a window, and the last signal its sessions carried for it (none before its first session) */
function Spent({ label, w }: { label: string; w: AccountWindow }) {
  const signal = w.status ? (SIGNAL[w.status] ?? { label: w.status.replace(/_/g, ' '), state: 'warn' }) : null;
  const reset = resetIn(w.resetsAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-ink-soft">{label}</span>
      <span className="mono text-ink">{fmtUsd(w.costUsd)} · {w.sessions} session{w.sessions === 1 ? '' : 's'}</span>
      {signal && <Badge state={signal.state}>{signal.label}</Badge>}
      {w.isUsingOverage && <Badge state="warn">overage</Badge>}
      {signal && reset && <span className="text-ink-faint">resets {reset}</span>}
    </span>
  );
}
