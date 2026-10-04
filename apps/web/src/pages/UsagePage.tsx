import { ProviderSelector } from '../components/ProviderSelector.tsx';
import type { MinimaxQuota, UsageBucket, WindowSummary } from '@foundry/engine/usage-types';
import { codexQuotaSummary } from '@foundry/engine/quota-windows';
import { Gauge, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AgentProvider, type Usage } from '../api.ts';
import { CodexQuotaCard } from '../components/CodexQuotaCard.tsx';
import { useLive } from '../store.ts';
import { Badge, Button, Card, Empty, cn, fmtUsd } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

export const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const untilText = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const fmtDur = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(0)} s` : `${(ms / 60_000).toFixed(1)} min`);

export function UsagePage() {
  const [query, setQuery] = useSearchParams();
  const provider: AgentProvider = query.get('provider') === 'codex' ? 'codex' : 'claude';
  return <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
    <div className="flex items-center gap-3 flex-wrap">
      <h1 className="text-lg font-semibold flex items-center gap-2"><Gauge size={18} /> {provider === 'codex' ? 'Codex' : 'Claude'} usage <HelpLink to="costs-and-usage" label="What costs money and how to spend less (new tab)" /></h1>
    </div>
    <ProviderSelector value={provider} onChange={(id) => setQuery((current) => { const next = new URLSearchParams(current); next.set('provider', id); return next; }, { replace: true })} />
    <ProviderUsage key={provider} provider={provider} />
  </div>;
}

/** Remount on backend changes so late reads and refreshes cannot replace another backend's data. */
function ProviderUsage({ provider }: { provider: AgentProvider }) {
  const version = useLive((s) => s.globalVersion);
  const [u, setU] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const t = setTimeout(() => api.usage(provider).then((value) => { if (current) { setU(value); setErr(null); } }).catch((e) => { if (current) setErr(e.message); }), 150);
    return () => { current = false; clearTimeout(t); };
  }, [version, provider]);
  const probe = async () => {
    setBusy(true);
    setErr(null);
    try {
      setU(await api.probeUsage(provider));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!u) return <Empty>{err ?? 'Loading usage…'}</Empty>;
  const t = u.totals;
  const cost = (value: number) => u.costAvailable === false ? '—' : fmtUsd(value);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-zinc-500">{provider === 'codex' ? 'Account quota and Foundry activity on this machine' : 'Foundry activity on this machine'}</span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={probe} title={provider === 'codex' ? 'Reads native Codex account limits without running inference' : 'Runs one tiny haiku session (~$0.02) to refresh the rate-limit signal'}>
          <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> {provider === 'codex' ? 'Refresh quota' : 'Refresh signal'}
        </Button>
        {err && <span className="text-xs text-rose-400 basis-full">{err}</span>}
      </div>
      {provider === 'codex' && <CodexQuotaCard quota={u.codexQuota} />}
      {u.pausedUntil && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
          {provider === 'codex' ? <>⏸ New Codex sessions are paused after a rate-limit response. Foundry's next retry is scheduled for {new Date(u.pausedUntil).toLocaleString()}; account availability is checked independently.</> : <>⏸ Rate limited — this backend is not starting new sessions and will resume automatically in {untilText(u.pausedUntil)} ({new Date(u.pausedUntil).toLocaleTimeString()}). Goals stay where they are.</>}
        </div>
      )}

      <UsageActivity provider={provider} u={u} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="cache hit rate (7d)" value={t.cacheHitRate == null ? '—' : `${(t.cacheHitRate * 100).toFixed(0)}%`} hint="cache-read tokens ÷ all input tokens" good={t.cacheHitRate != null && t.cacheHitRate > 0.6} />
        <Kpi label="avg cost / session (7d)" value={t.avgCostPerSession == null ? '—' : cost(t.avgCostPerSession)} />
        <Kpi label="avg session length (7d)" value={fmtDur(t.avgDurationMs)} />
        <Kpi label="sessions not successful (7d)" value={String(t.errorSessions)} hint="ended with an error, timeout or kill" good={t.errorSessions === 0} bad={t.errorSessions > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="By goal (7d, top 10)">
          {u.byGoal.length === 0 ? (
            <div className="text-xs text-zinc-500">nothing yet</div>
          ) : (
            <div className="text-xs space-y-1.5">
              {u.byGoal.map((g) => (
                <div key={g.goalId ?? 'none'} className="flex items-center gap-2">
                  {g.goalId ? (
                    <Link className="truncate flex-1 text-zinc-200 hover:underline" to={`/goals/${g.goalId}`} title={g.goalId}>
                      {g.title ?? g.goalId}
                    </Link>
                  ) : (
                    <span className="truncate flex-1 text-zinc-400">no goal (probes, setup)</span>
                  )}
                  {g.state && <Badge state={g.state} className="shrink-0" />}
                  <span className="text-zinc-500 shrink-0">{g.sessions}×</span>
                  <span className="mono text-zinc-300 w-14 text-right shrink-0">{cost(g.costUsd)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="By session kind (7d)">
          <Rows rows={u.byKind.map((k) => [k.kind, `${k.sessions}× · ${fmtDur(k.avgDurationMs)}`, cost(k.costUsd)])} />
        </Card>
        <Card title="By model (7d)">
          <Rows rows={u.byModel.map((m) => [m.model, `${m.sessions}× · ${fmtK(m.outputTokens)} out`, cost(m.costUsd)])} />
        </Card>
      </div>
      <p className="text-xs text-zinc-500">{u.note}</p>
      <MinimaxCard />
    </div>
  );
}

/** MiniMax quota (video and narration through mmx), read when the page opens; hidden when mmx is not installed. */
function MinimaxCard() {
  const [q, setQ] = useState<MinimaxQuota | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (refresh: boolean) => {
    setBusy(true);
    api
      .minimaxQuota(refresh)
      .then(setQ)
      .catch((e) => setQ({ state: 'error', message: e.message, checkedAt: new Date().toISOString() }))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(true), []);
  if (!q || (q.state === 'unavailable' && q.reason === 'no-cli')) return null;
  const low = (q.state === 'plan' || q.state === 'balance') && q.low;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          MiniMax
          {low && <Badge state="warn">low</Badge>}
        </span>
      }
      actions={
        <>
          <span className="text-[11px] text-zinc-500">checked {new Date(q.checkedAt).toLocaleTimeString()}</span>
          <Button size="sm" disabled={busy} onClick={() => load(true)} title="Runs mmx quota show">
            <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> Refresh
          </Button>
        </>
      }
    >
      {q.state === 'unavailable' && (
        <div className="text-xs text-zinc-400">
          mmx is installed but has no key. Add one under <Link className="underline" to="/settings#tools">Settings → Tools &amp; keys</Link>, or run <span className="mono">mmx auth login</span>.
        </div>
      )}
      {q.state === 'error' && <div className="text-xs text-rose-400">{q.message}</div>}
      {q.state === 'balance' && (
        <div>
          <div className={cn('text-2xl font-semibold mono', q.low ? 'text-amber-300' : 'text-zinc-100')}>{q.available.toFixed(2)}</div>
          <div className="text-[11px] text-zinc-500">pay-as-you-go balance available</div>
        </div>
      )}
      {q.state === 'plan' && (
        <div className="space-y-2">
          {q.models.length === 0 && <div className="text-xs text-zinc-500">no models in this plan</div>}
          {q.models.map((m) => (
            <div key={m.name} className="text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-zinc-200 truncate flex-1">{m.name}</span>
                <span className="mono text-zinc-300">{m.remainingPercent == null ? '—' : `${m.remainingPercent}% left`}</span>
                {m.weeklyRemainingPercent != null && <span className="text-zinc-500">· week {m.weeklyRemainingPercent}%</span>}
                {m.resetsAt && <span className="text-zinc-500">· resets in {untilText(m.resetsAt)}</span>}
              </div>
              <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
                <div className={cn('h-full', (m.remainingPercent ?? 100) < 10 ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: `${Math.max(0, Math.min(100, m.remainingPercent ?? 0))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Fixed reporting periods describe local activity; they do not create account quota windows. */
export function UsageActivity({ provider, u }: { provider: AgentProvider; u: Pick<Usage, 'costAvailable' | 'fiveHour' | 'sevenDay' | 'series' | 'now'> }) {
  if (provider === 'codex') return <div className="space-y-2">
    <p className="text-xs text-zinc-500">Local activity over the last 7 days. This reporting period is not an account limit.</p>
    <WindowCard showSignal={false} costAvailable={false} w={{ ...u.sevenDay, label: 'Foundry activity · last 7 days' }} series={u.series.daily} now={u.now} />
  </div>;
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <WindowCard costAvailable={u.costAvailable} w={u.fiveHour} series={u.series.hourly} now={u.now} />
    <WindowCard costAvailable={u.costAvailable} w={u.sevenDay} series={u.series.daily} now={u.now} />
  </div>;
}

/** Local activity totals, with native signal/reset details only when that backend supplies them. */
function WindowCard({ w, series, now, costAvailable = true, showSignal = true }: { costAvailable?: boolean; showSignal?: boolean; w: WindowSummary; series: UsageBucket[]; now: string }) {
  const state = !w.status ? 'pending' : w.status === 'allowed' ? 'pass' : w.status === 'allowed_warning' ? 'warn' : 'fail';
  const start = Date.parse(w.windowStart);
  const end = Date.parse(w.windowEnd);
  const elapsed = Math.min(100, Math.max(0, ((Date.parse(now) - start) / Math.max(1, end - start)) * 100));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {w.label}
          {showSignal && <Badge state={state}>{w.status ?? 'no signal yet'}</Badge>}
          {showSignal && w.isUsingOverage && <Badge state="warn">overage</Badge>}
        </span>
      }
      actions={<span className="text-[11px] text-zinc-500">{showSignal ? (w.resetsAt ? (Date.parse(w.resetsAt) > Date.parse(now) ? `resets in ${untilText(w.resetsAt)}` : 'rolled over — next signal sets the window') : 'no reset signal yet') : 'Foundry activity'}</span>}
    >
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <div className="text-2xl font-semibold mono text-zinc-100">{costAvailable ? fmtUsd(w.costUsd) : fmtK(w.outputTokens) + ' tokens'}</div>
          <div className="text-[11px] text-zinc-500">{w.sessions} session{w.sessions === 1 ? '' : 's'} · {costAvailable ? 'est. cost' : 'output tokens'}</div>
        </div>
        <div className="grid grid-cols-3 gap-x-4 text-[11px] ml-auto">
          <Stat label="output" value={fmtK(w.outputTokens)} />
          <Stat label="input" value={fmtK(w.inputTokens)} />
          <Stat label="cache read" value={fmtK(w.cacheReadTokens)} />
        </div>
      </div>
      {showSignal && <div className="mt-3">
        <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
          <span>window {new Date(start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>{w.resetsAt ? `resets ${new Date(w.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'rolling'}</span>
        </div>
        <div className="h-1.5 rounded bg-zinc-800 overflow-hidden" title={`${elapsed.toFixed(0)}% of the window elapsed (time, not quota)`}>
          <div className="h-full bg-zinc-500" style={{ width: `${elapsed}%` }} />
        </div>
      </div>}
      <Bars buckets={series} costAvailable={costAvailable} />
      {showSignal && w.lastSignalAt && <div className="text-[10px] text-zinc-600 mt-2">last rate-limit signal {new Date(w.lastSignalAt).toLocaleTimeString()}</div>}
    </Card>
  );
}

/** Cost per bucket as plain divs; hover shows the detail. */
function Bars({ buckets, costAvailable }: { buckets: UsageBucket[]; costAvailable: boolean }) {
  const value = (b: UsageBucket) => costAvailable ? b.costUsd : b.outputTokens;
  const max = Math.max(0.0001, ...buckets.map(value));
  return (
    <div className="mt-3">
      <div className="flex items-end gap-1 h-16">
        {buckets.map((b) => (
          <div key={b.t} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${b.label}: ${costAvailable ? fmtUsd(b.costUsd) : 'cost unavailable'} · ${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${fmtK(b.outputTokens)} output tokens`}>
            <div className={cn('w-full rounded-t transition-colors', value(b) > 0 ? 'bg-emerald-500/70 group-hover:bg-emerald-400' : 'bg-zinc-800')} style={{ height: `${value(b) > 0 ? Math.max(6, (value(b) / max) * 100) : 2}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {buckets.map((b) => (
          <div key={b.t} className="flex-1 text-center text-[9px] text-zinc-600 truncate">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, good, bad }: { label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className={cn('mono text-lg', bad ? 'text-rose-300' : good ? 'text-emerald-300' : 'text-zinc-100')}>{value}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="mono text-zinc-200">{value}</div>
    </div>
  );
}
function Rows({ rows }: { rows: (string | JSX.Element)[][] }) {
  if (!rows.length) return <div className="text-xs text-zinc-500">nothing yet</div>;
  return (
    <div className="text-xs space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-center">
          <span className="flex-1 truncate text-zinc-200">{r[0]}</span>
          <span className="text-zinc-500 shrink-0">{r[1]}</span>
          <span className="mono text-zinc-300 w-14 text-right shrink-0">{r[2]}</span>
        </div>
      ))}
    </div>
  );
}

/** Header pill: account-derived Codex quota, or Claude's local cost and native signal. */
export function UsagePill() {
  const version = useLive((s) => s.globalVersion);
  const [u, setU] = useState<Usage | null>(null);
  const [minimaxLow, setMinimaxLow] = useState(false);
  // the engine keeps the MiniMax quota for 10 minutes; asking more often costs nothing
  useEffect(() => {
    const load = () => api.minimaxQuota().then((q) => setMinimaxLow((q.state === 'plan' || q.state === 'balance') && q.low)).catch(() => {});
    const t = setTimeout(load, 2000);
    const i = setInterval(load, 5 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);
  useEffect(() => {
    const load = () => api.usage().then(setU).catch(() => {});
    const t = setTimeout(load, 300);
    const i = setInterval(load, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [version]);
  if (!u) return null;
  return <UsagePillView u={u} minimaxLow={minimaxLow} />;
}

export function UsagePillView({ u, minimaxLow = false }: { u: Usage; minimaxLow?: boolean }) {
  const w = u.fiveHour;
  const codex = u.provider === 'codex';
  const blocked = codex ? u.codexQuota?.state === 'available' && u.codexQuota.ordinaryUsageAllowed === false : !!w.status && w.status !== 'allowed';
  const color = u.pausedUntil ? 'text-amber-300 border-amber-500/40' : blocked ? 'text-rose-300 border-rose-500/40' : 'text-zinc-300 border-zinc-700';
  const summary = `${codex ? 'Codex' : 'Claude'} · ${u.pausedUntil ? `paused ${untilText(u.pausedUntil)}` : codex ? codexQuotaSummary(u.codexQuota) : `5h ${fmtUsd(w.costUsd)}`}`;
  return (
    <Link to={`/usage?provider=${u.provider ?? 'claude'}`} aria-label={`Usage: ${summary}${minimaxLow ? '. MiniMax quota low' : ''}`} className={cn('flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] mono', color)} title={`${summary}\n${minimaxLow ? `MiniMax quota low: under 10% of a window left, or a balance under 1 — see Usage\n${u.note}` : u.note}`}>
      <Gauge size={12} />
      <span className="hidden sm:inline whitespace-nowrap">{summary}</span>
      {!codex && w.resetsAt && !u.pausedUntil && <span className="text-zinc-500 hidden lg:inline whitespace-nowrap">· reset {untilText(w.resetsAt)}</span>}
      {/* the header has little room: an amber dot, and words only on wide screens */}
      {minimaxLow && (
        <span className="flex items-center gap-1 text-amber-300 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="hidden 2xl:inline">MiniMax low</span>
        </span>
      )}
    </Link>
  );
}
