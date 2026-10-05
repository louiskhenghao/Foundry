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
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { HelpLink } from './HelpPage.tsx';
import { ProviderBadge } from './agents/rows.tsx';

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
  // shared numbers first, so switching the coding agent below moves nothing above it
  return <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-6">
    <div className="space-y-3">
      <h1 className="text-lg font-semibold flex items-center gap-2"><Gauge size={18} /> Usage <HelpLink to="costs-and-usage" label="What costs money and how to spend less (new tab)" /></h1>
      <UsagePausedBanner />
    </div>
    <FoundryActivity />
    <section className="space-y-3 border-t border-zinc-800 pt-5" aria-labelledby="account-limits">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 id="account-limits" className="text-sm font-medium text-zinc-200">Account limits</h2>
          <p className="text-xs text-zinc-500">What each coding agent's account allows, and what Foundry used within it.</p>
        </div>
        <ProviderSelector hideLabel value={provider} onChange={(id) => setQuery((current) => { const next = new URLSearchParams(current); next.set('provider', id); return next; }, { replace: true })} />
      </div>
      <ProviderUsage key={provider} provider={provider} />
    </section>
    <MinimaxCard />
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-zinc-500">{provider === 'codex' ? 'The ChatGPT account’s quota, and Foundry’s Codex activity on this machine' : 'Claude’s usage windows, and what Foundry spent in each on this machine'}</span>
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
    </div>
  );
}

/**
 * What Foundry recorded over the last 7 days, for both coding agents together: these numbers come from Foundry's own
 * session ledger, not from either account. Time and tokens exist for both agents, so rows are compared by them;
 * dollars exist for Claude Code only and stay a column of their own.
 */
function FoundryActivity() {
  const version = useLive((s) => s.globalVersion);
  const [both, setBoth] = useState<Partial<Record<AgentProvider, Usage>> | null>(null);
  useEffect(() => {
    let current = true;
    const t = setTimeout(async () => {
      const providers = ['claude', 'codex'] as const;
      const results = await Promise.allSettled(providers.map((p) => api.usage(p)));
      if (current) setBoth(Object.fromEntries(results.flatMap((r, i) => (r.status === 'fulfilled' ? [[providers[i], r.value]] : []))));
    }, 200);
    return () => { current = false; clearTimeout(t); };
  }, [version]);
  if (!both) return null;
  const m = mergeActivity(both);
  return (
    <section className="space-y-3" aria-labelledby="foundry-activity">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 id="foundry-activity" className="text-sm font-medium text-zinc-200">Foundry activity · last 7 days</h2>
        <span className="text-xs text-zinc-500">Claude Code and Codex together, as recorded by Foundry.</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="cache hit rate" value={m.cacheHitRate == null ? '—' : `${(m.cacheHitRate * 100).toFixed(0)}%`} hint="cache-read tokens ÷ all input tokens" good={m.cacheHitRate != null && m.cacheHitRate > 0.6} />
        <Kpi label="avg cost / Claude session" value={m.avgCostPerSession == null ? '—' : fmtUsd(m.avgCostPerSession)} hint="Claude Code only: Codex reports no dollar cost" />
        <Kpi label="avg session length" value={fmtDur(m.avgDurationMs)} />
        <Kpi label="sessions not successful" value={String(m.errorSessions)} hint="ended with an error, timeout or kill" good={m.errorSessions === 0} bad={m.errorSessions > 0} />
      </div>
      <ActivityTable m={m} />
      <p className="text-xs text-zinc-500">
        Time and tokens cover both coding agents. Cost is estimated for Claude Code only; Codex reports no dollar cost, so its rows show —, and <span className="mono">*</span> marks a row whose cost leaves out its Codex sessions. Counts only sessions started by Foundry on this machine. Account limits are below, per coding agent; for exact Claude percentages run /usage inside Claude Code.
      </p>
    </section>
  );
}

type SortKey = 'durationMs' | 'sessions' | 'tokens' | 'costUsd';
const TABS = [
  { id: 'goal', label: 'By goal' },
  { id: 'kind', label: 'By session kind' },
  { id: 'model', label: 'By model' },
] as const;
const totalTokens = (r: ActivityRow) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheCreate + r.tokens.output;
const fmtSpan = (ms: number) => {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
};

/** One breakdown at a time, as a table sortable by any measure (time first: both coding agents report it). */
function ActivityTable({ m }: { m: ReturnType<typeof mergeActivity> }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('goal');
  const [sort, setSort] = useState<SortKey>('durationMs');
  const rows = [...(tab === 'goal' ? m.byGoal : tab === 'kind' ? m.byKind : m.byModel)].sort((a, b) => {
    const v = (r: ActivityRow) => (sort === 'tokens' ? totalTokens(r) : sort === 'costUsd' ? (r.costUsd ?? -1) : r[sort]);
    return v(b) - v(a) || b.durationMs - a.durationMs;
  });
  const cost = (r: ActivityRow) =>
    r.costUsd == null ? (
      <span className="text-zinc-600" title="Codex reports no dollar cost">—</span>
    ) : (
      <span title={r.partial ? 'Claude Code sessions only: this row’s Codex sessions report no dollar cost' : undefined}>
        {fmtUsd(r.costUsd)}
        {r.partial && <span className="text-zinc-500">*</span>}
      </span>
    );
  const tokensCell = (r: ActivityRow) => <span title={`input ${fmtK(r.tokens.input)} · cache read ${fmtK(r.tokens.cacheRead)} · cache write ${fmtK(r.tokens.cacheCreate)} · output ${fmtK(r.tokens.output)}`}>{fmtK(totalTokens(r))}</span>;
  const name = (r: ActivityRow) => (
    <span className="flex items-center gap-1.5 min-w-0">
      {r.agents.map((a) => (
        <ProviderBadge key={a} provider={a} compact />
      ))}
      {r.goalId ? (
        <Link className="truncate text-zinc-200 hover:underline" to={`/goals/${r.goalId}`} title={r.label}>
          {r.label}
        </Link>
      ) : (
        <span className={cn('truncate', r.muted ? 'text-zinc-400' : 'text-zinc-200')} title={r.label}>
          {r.label}
        </span>
      )}
      {r.state && <Badge state={r.state} className="shrink-0" />}
    </span>
  );
  const head = (key: SortKey, label: string, hint?: string) => (
    <th className="py-2 pl-3 font-medium text-right" aria-sort={sort === key ? 'descending' : 'none'}>
      <button type="button" className={cn('uppercase tracking-wide hover:text-zinc-300', sort === key && 'text-zinc-200')} onClick={() => setSort(key)} title={hint ?? `Sort by ${label.toLowerCase()}`}>
        {label}
        {sort === key ? ' ↓' : ''}
      </button>
    </th>
  );
  return (
    <div className="surface-card rounded-lg border border-zinc-800">
      <div role="tablist" aria-label="Breakdown" className="flex gap-1 border-b border-zinc-800 px-2 pt-2 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('whitespace-nowrap rounded-t-md px-3 py-1.5 text-xs border-b-2 -mb-px', tab === t.id ? 'border-emerald-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-xs text-zinc-500">nothing yet</div>
      ) : (
        <>
          {/* tablets and up: one sortable table */}
          <table className="hidden sm:table w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                <th className="py-2 px-3 font-medium">{TABS.find((t) => t.id === tab)!.label.replace('By ', '')}</th>
                {head('sessions', 'Sessions')}
                {head('durationMs', 'Time', 'Sort by time spent in sessions (both coding agents)')}
                {head('tokens', 'Tokens', 'Sort by tokens processed (both coding agents)')}
                {head('costUsd', 'Cost', 'Sort by estimated cost (Claude Code only)')}
                <th className="w-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-900 last:border-b-0">
                  <td className="py-1.5 px-3 max-w-0 w-full">{name(r)}</td>
                  <td className="py-1.5 pl-3 text-right text-zinc-400 tabular-nums">{r.sessions}</td>
                  <td className="py-1.5 pl-3 text-right mono text-zinc-200 whitespace-nowrap">{fmtSpan(r.durationMs)}</td>
                  <td className="py-1.5 pl-3 text-right mono text-zinc-400 whitespace-nowrap">{tokensCell(r)}</td>
                  <td className="py-1.5 pl-3 text-right mono text-zinc-300 whitespace-nowrap">{cost(r)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {/* phones: one line of measures under each name */}
          <ul className="sm:hidden divide-y divide-zinc-800/70 text-xs">
            {rows.map((r) => (
              <li key={r.id} className="px-3 py-2 space-y-1">
                {name(r)}
                <div className="flex gap-3 text-[11px] text-zinc-500">
                  <span>{r.sessions}×</span>
                  <span className="mono text-zinc-300">{fmtSpan(r.durationMs)}</span>
                  <span className="mono">{tokensCell(r)} tokens</span>
                  <span className="mono ml-auto">{cost(r)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** one breakdown row for both coding agents: time and tokens from both, cost from Claude Code only */
export interface ActivityRow {
  id: string;
  label: string;
  goalId: string | null;
  state: string | null;
  /** "no goal" and similar rows that are not a thing to open */
  muted: boolean;
  agents: AgentProvider[];
  sessions: number;
  durationMs: number;
  tokens: { input: number; cacheRead: number; cacheCreate: number; output: number };
  /** Claude Code's part; null when the row has no Claude Code sessions */
  costUsd: number | null;
  /** the row also has Codex sessions, which the cost leaves out */
  partial: boolean;
}

type Part = { sessions: number; costUsd: number; durationMs?: number; avgDurationMs?: number; inputTokens?: number; cacheReadTokens?: number; cacheCreateTokens?: number; outputTokens?: number };

/** Both agents' 7-day breakdowns as one; Codex contributes sessions, time and tokens but no cost. */
export function mergeActivity(both: Partial<Record<AgentProvider, Pick<Usage, 'sevenDay' | 'byGoal' | 'byKind' | 'byModel' | 'totals'>>>) {
  const parts = (['claude', 'codex'] as const).flatMap((p) => (both[p] ? [{ p, u: both[p]! }] : []));
  const merge = (map: Map<string, ActivityRow>, id: string, base: Pick<ActivityRow, 'label' | 'goalId' | 'state' | 'muted'>, p: AgentProvider, x: Part) => {
    const row = map.get(id) ?? { id, ...base, agents: [], sessions: 0, durationMs: 0, tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 }, costUsd: null, partial: false };
    if (!row.agents.includes(p)) row.agents.push(p);
    row.sessions += x.sessions;
    // summaries from before time totals existed carry an average instead
    row.durationMs += x.durationMs ?? (x.avgDurationMs ?? 0) * x.sessions;
    row.tokens.input += x.inputTokens ?? 0;
    row.tokens.cacheRead += x.cacheReadTokens ?? 0;
    row.tokens.cacheCreate += x.cacheCreateTokens ?? 0;
    row.tokens.output += x.outputTokens ?? 0;
    if (p === 'claude') row.costUsd = (row.costUsd ?? 0) + x.costUsd;
    row.partial = row.agents.length > 1 && row.costUsd != null;
    map.set(id, row);
  };
  const goals = new Map<string, ActivityRow>();
  const kinds = new Map<string, ActivityRow>();
  const models = new Map<string, ActivityRow>();
  for (const { p, u } of parts) {
    for (const g of u.byGoal) merge(goals, g.goalId ?? '', { label: g.goalId ? (g.title ?? g.goalId) : 'no goal (probes, setup)', goalId: g.goalId, state: g.state, muted: !g.goalId }, p, g);
    for (const k of u.byKind) merge(kinds, k.kind, { label: k.kind, goalId: null, state: null, muted: false }, p, k);
    for (const x of u.byModel) merge(models, `${p}:${x.model}`, { label: x.model, goalId: null, state: null, muted: false }, p, x);
  }
  const byTime = (a: ActivityRow, b: ActivityRow) => b.durationMs - a.durationMs || b.sessions - a.sessions;
  const sessions = parts.reduce((n, { u }) => n + u.sevenDay.sessions, 0);
  const read = parts.reduce((n, { u }) => n + u.sevenDay.cacheReadTokens, 0);
  const input = parts.reduce((n, { u }) => n + u.sevenDay.inputTokens + u.sevenDay.cacheReadTokens, 0);
  const durTotal = parts.reduce((n, { u }) => n + (u.totals.avgDurationMs ?? 0) * u.sevenDay.sessions, 0);
  return {
    byGoal: [...goals.values()].sort(byTime),
    byKind: [...kinds.values()].sort(byTime),
    byModel: [...models.values()].sort(byTime),
    cacheHitRate: input > 0 ? read / input : null,
    avgCostPerSession: both.claude?.totals.avgCostPerSession ?? null,
    avgDurationMs: sessions ? Math.round(durTotal / sessions) : null,
    errorSessions: parts.reduce((n, { u }) => n + u.totals.errorSessions, 0),
  };
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

/** Claude's rate-limit signal for a window: `allowed_warning` means still allowed, but close to the limit. */
const SIGNAL: Record<string, { label: string; hint?: string }> = {
  allowed: { label: 'within limit' },
  allowed_warning: { label: 'nearing limit', hint: 'Still allowed, but Claude warns this window is close to its limit. Sessions keep running; at the limit Foundry pauses new Claude sessions until the reset.' },
  rejected: { label: 'limit reached', hint: 'Claude rejects new requests in this window until it resets. Foundry pauses new Claude sessions and retries then.' },
};
const signalLabel = (status: string) => SIGNAL[status]?.label ?? status.replace(/_/g, ' ');

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
          {showSignal && <Badge state={state}>{w.status ? signalLabel(w.status) : w.lastSignalAt ? 'no current signal' : 'no signal yet'}</Badge>}
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
          <span>{w.resetsAt && Date.parse(w.resetsAt) > Date.parse(now) ? `resets ${new Date(w.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'rolling'}</span>
        </div>
        <div className="h-1.5 rounded bg-zinc-800 overflow-hidden" title={`${elapsed.toFixed(0)}% of the window elapsed (time, not quota)`}>
          <div className="h-full bg-zinc-500" style={{ width: `${elapsed}%` }} />
        </div>
      </div>}
      <Bars buckets={series} costAvailable={costAvailable} />
      {showSignal && w.status && SIGNAL[w.status]?.hint && <p className={cn('text-[11px] mt-3', state === 'warn' ? 'text-amber-300' : 'text-rose-300')}>{SIGNAL[w.status]!.hint}</p>}
      {showSignal && w.lastSignalAt && <div className="text-[10px] text-zinc-600 mt-2">last rate-limit signal {new Date(w.lastSignalAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{!w.status && ' · that window has since reset; Claude sends a new one when this window nears its limit'}</div>}
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

/** A stable, provider-neutral entry point; independent native summaries live in the tooltip. */
export function UsagePill() {
  const version = useLive((s) => s.globalVersion);
  const [usages, setUsages] = useState<Partial<Record<AgentProvider, Usage>>>({});
  const [minimaxLow, setMinimaxLow] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.minimaxQuota().then((q) => { if (alive) setMinimaxLow((q.state === 'plan' || q.state === 'balance') && q.low); }).catch(() => {});
    const t = setTimeout(load, 2000);
    const i = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearTimeout(t); clearInterval(i); };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const providers = ['claude', 'codex'] as const;
      const results = await Promise.allSettled(providers.map(provider => api.usage(provider)));
      if (alive) setUsages(Object.fromEntries(results.flatMap((result, index) => result.status === 'fulfilled' ? [[providers[index], result.value]] : [])));
    };
    const t = setTimeout(load, 300);
    const i = setInterval(load, 30_000);
    return () => { alive = false; clearTimeout(t); clearInterval(i); };
  }, [version]);
  return <UsagePillView usages={usages} minimaxLow={minimaxLow} />;
}

export function UsagePillView({ usages, minimaxLow = false }: { usages: Partial<Record<AgentProvider, Usage>>; minimaxLow?: boolean }) {
  const values = Object.values(usages);
  const paused = values.some(u => u.pausedUntil && Date.parse(u.pausedUntil) > Date.now());
  const blocked = values.some(u => u.provider === 'codex' ? u.codexQuota?.state === 'available' && u.codexQuota.ordinaryUsageAllowed === false : !!u.fiveHour.status && u.fiveHour.status !== 'allowed');
  const attention = paused || blocked || minimaxLow;
  const summaries = (['claude', 'codex'] as const).map(provider => {
    const u = usages[provider];
    const name = provider === 'codex' ? 'Codex' : 'Claude Code';
    if (!u) return `${name} · usage unavailable`;
    return `${name} · ${u.pausedUntil && Date.parse(u.pausedUntil) > Date.now() ? 'sessions paused · ' : ''}${provider === 'codex' ? codexQuotaSummary(u.codexQuota) : `Foundry activity (5h) ${fmtUsd(u.fiveHour.costUsd)}`}`;
  });
  const title = [...summaries, ...(minimaxLow ? ['MiniMax quota low'] : []), 'Open Usage to view each coding agent separately.'].join('\n');
  return <Link to="/usage" aria-label={`Usage across Claude Code and Codex${attention ? ' · needs attention' : ''}`} title={title} className={cn('flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs', attention ? 'text-amber-300 border-amber-500/40' : 'text-zinc-300 border-zinc-700 hover:bg-zinc-900')}>
    <Gauge size={14} /><span className="hidden sm:inline">Usage</span>
    {attention && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />}
  </Link>;
}
