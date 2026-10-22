import { ProviderSelector } from '../components/ProviderSelector.tsx';
import type { MinimaxQuota, UsageBucket, WindowSummary } from '@foundry/engine/usage-types';
import { agyQuotaExhausted, agyQuotaSummary, codexQuotaSummary } from '@foundry/engine/quota-windows';
import { AGENT_PROVIDERS, PROVIDER_LABEL, PROVIDER_NAME, reportsDollars } from '@foundry/core/browser';
import { Activity, Gauge, Pause, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type AgentProvider, type Usage } from '../api.ts';
import { AgyQuotaCard } from '../components/AgyQuotaCard.tsx';
import { AccountsUsageCard } from '../components/AccountsUsageCard.tsx';
import { CodexQuotaCard } from '../components/CodexQuotaCard.tsx';
import { useLive } from '../store.ts';
import { BOARD_ROW, Badge, Button, Card, Empty, EmptyState, PageHeader, cn, code, fmtUsd } from '../ui.tsx';
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

/**
 * The colours the charts of Usage and Reports draw their series in: category colours (ADR-0067), never a state. Spend
 * is blue wherever it is charted, time violet; green stays for what finished and how a limit stands.
 */
export const SERIES = { spend: code(0), time: code(2) };

export function UsagePage() {
  const [query, setQuery] = useSearchParams();
  const provider: AgentProvider = AGENT_PROVIDERS.find((p) => p === query.get('provider')) ?? 'claude';
  // shared numbers first, so switching the coding agent below moves nothing above it
  return <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16">
    <div className="mb-3">
      <UsagePausedBanner />
    </div>
    <PageHeader title="Usage" help={<HelpLink to="costs-and-usage" label="What costs money and how to spend less (new tab)" />} />
    <div className="space-y-12">
      <FoundryActivity />
      <section className="space-y-4" aria-labelledby="account-limits">
        <SectionHead
          id="account-limits"
          icon={<Gauge size={14} aria-hidden="true" />}
          title="Account limits"
          note="What each coding agent's account allows, and what Foundry used within it."
          aside={<ProviderSelector hideLabel value={provider} onChange={(id) => setQuery((current) => { const next = new URLSearchParams(current); next.set('provider', id); return next; }, { replace: true })} />}
        />
        <ProviderUsage key={provider} provider={provider} />
      </section>
      <MinimaxCard />
    </div>
  </div>;
}

/**
 * A section of the page, headed as the Goals page's boards are: a small icon, its name in capitals, a line on what it
 * holds. `relative`: the coding-agent picker's hidden legend is placed against this box, not the page's body, where it
 * made the whole page scroll past <main> on a phone.
 */
function SectionHead({ id, icon, title, note, aside }: { id: string; icon: ReactNode; title: ReactNode; note: ReactNode; aside?: ReactNode }) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2.5 text-[12.5px] font-extrabold caps text-ink">
          {icon}
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-faint">{note}</p>
      </div>
      {aside}
    </div>
  );
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
  const resume = async () => {
    setBusy(true);
    try {
      await api.resumeUsage(provider);
      setU(await api.usage(provider));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!u) return <Empty>{err ?? 'Loading usage…'}</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <span className="text-[13px] text-ink-faint">{provider === 'codex' ? 'The ChatGPT account’s quota, and Foundry’s Codex activity on this machine' : provider === 'agy' ? 'The Google account’s Antigravity quota, and Foundry’s Antigravity activity on this machine' : 'Claude’s usage windows, and what Foundry spent in each on this machine'}</span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={probe} title={provider === 'codex' ? 'Reads native Codex account limits without running inference' : provider === 'agy' ? 'Reads the account quota with agy /usage, without running a model' : 'Runs one tiny haiku session (~$0.02) to refresh the rate-limit signal'}>
          <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> {provider === 'claude' ? 'Refresh signal' : 'Refresh quota'}
        </Button>
        {err && <span className="text-xs text-bad-ink basis-full">{err}</span>}
        {/* several accounts: the quota and windows below are the current account's (ADR-0065) */}
        {u.currentAccount && <span className="text-xs text-ink-soft basis-full">Windows and quota of the current account, <span className="font-semibold text-ink">{u.currentAccount}</span>; the activity totals count every account.</span>}
      </div>
      {u.accounts && <AccountsUsageCard provider={provider} accounts={u.accounts} />}
      {provider === 'codex' && <CodexQuotaCard quota={u.codexQuota} />}
      {provider === 'agy' && <AgyQuotaCard quota={u.agyQuota} />}
      {/* a sign that waits for you: the yellow on its small marks only, the sign's square and a thin edge, on a calm
          panel; Resume now is the person's to press */}
      {u.pausedUntil && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-panel py-2.5 pl-4 pr-3 shadow-[inset_4px_0_0_var(--color-you),var(--surface-shadow)] sm:pl-5 sm:pr-4">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
            <Pause size={14} strokeWidth={2.75} />
          </span>
          <span className="min-w-0 flex-1 basis-64 text-sm leading-snug text-ink">
            {provider !== 'claude' ? <>New {PROVIDER_LABEL[provider]} sessions are paused after a rate-limit response. Foundry's next retry is scheduled for {new Date(u.pausedUntil).toLocaleString()}; account availability is checked independently.</> : <>Rate limited — this backend is not starting new sessions and will resume automatically in {untilText(u.pausedUntil)} ({new Date(u.pausedUntil).toLocaleString()}). Goals stay where they are.</>}
          </span>
          <Button type="button" size="sm" disabled={busy} onClick={resume} title="Start sessions again now; if the limit still holds, the next session pauses them again">
            Resume now
          </Button>
        </div>
      )}

      <UsageActivity provider={provider} u={u} />
    </div>
  );
}

/**
 * What Foundry recorded over the last 7 days, for every coding agent together: these numbers come from Foundry's own
 * session ledger, not from any account. Time and tokens exist for every agent, so rows are compared by them;
 * dollars exist for Claude Code only and stay a column of their own.
 */
function FoundryActivity() {
  const version = useLive((s) => s.globalVersion);
  const [both, setBoth] = useState<Partial<Record<AgentProvider, Usage>> | null>(null);
  useEffect(() => {
    let current = true;
    const t = setTimeout(async () => {
      const providers = AGENT_PROVIDERS;
      const results = await Promise.allSettled(providers.map((p) => api.usage(p)));
      if (current) setBoth(Object.fromEntries(results.flatMap((r, i) => (r.status === 'fulfilled' ? [[providers[i], r.value]] : []))));
    }, 200);
    return () => { current = false; clearTimeout(t); };
  }, [version]);
  if (!both) return null;
  const m = mergeActivity(both);
  return (
    <section className="space-y-4" aria-labelledby="foundry-activity">
      <SectionHead
        id="foundry-activity"
        icon={<Activity size={14} aria-hidden="true" />}
        title="Foundry activity · last 7 days"
        note="Every coding agent together, as recorded by Foundry."
        aside={
          <Link to="/reports" className="-my-1.5 py-1.5 text-[13px] font-semibold text-work-ink hover:underline underline-offset-2" title="Longer windows, by project and over time, with retries and estimate error">
            Longer windows, by project: Reports →
          </Link>
        }
      />
      {/* two to a row on a phone, three on a tablet, all five on a wide screen; a row's tiles grow to fill it, so the
          last row never ends in a gap */}
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:grow [&>*]:basis-[40%] sm:[&>*]:basis-[30%] lg:[&>*]:basis-0">
        <Kpi label="cache hit rate" value={m.cacheHitRate == null ? '—' : `${(m.cacheHitRate * 100).toFixed(0)}%`} hint="cache-read tokens ÷ all input tokens" good={m.cacheHitRate != null && m.cacheHitRate > 0.6} />
        <Kpi label="avg cost / Claude session" value={m.avgCostPerSession == null ? '—' : fmtUsd(m.avgCostPerSession)} hint="Claude Code only: Codex and Antigravity report no dollar cost" />
        <Kpi label="avg session length" value={fmtDur(m.avgDurationMs)} />
        <Kpi label="sessions not successful" value={String(m.errorSessions)} hint="ended with an error, timeout or kill" good={m.errorSessions === 0} bad={m.errorSessions > 0} />
        <Kpi label="sessions with unknown cost" value={String(m.unmeasuredSessions)} hint="Claude Code sessions cut before a cost was reported: unknown, not $0, and missing from every cost here" good={m.unmeasuredSessions === 0} bad={m.unmeasuredSessions > 0} />
      </div>
      <Breakdowns m={m} />
      <p className="text-xs leading-relaxed text-ink-faint">
        Rows are listed by time, which every coding agent reports. Cost is estimated for Claude Code only; Codex and Antigravity report no dollar cost, so their rows show —, and <span className="mono">*</span> marks a row whose cost leaves sessions out: its Codex or Antigravity sessions, or Claude Code sessions cut before a cost was reported (unknown, not $0). Counts only sessions started by Foundry on this machine. Account limits are below, per coding agent; for exact Claude percentages run /usage inside Claude Code.
      </p>
    </section>
  );
}

const totalTokens = (r: ActivityRow) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheCreate + r.tokens.output;
const fmtSpan = (ms: number) => {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
};

/**
 * The three breakdowns side by side on a wide screen, all visible at once; one under another below that, where three
 * columns would cut every goal's title short. Rows by time, which both coding agents report.
 */
function Breakdowns({ m }: { m: ReturnType<typeof mergeActivity> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Breakdown title="By goal" rows={m.byGoal} />
      <Breakdown title="By session kind" rows={m.byKind} />
      <Breakdown title="By model" rows={m.byModel} />
    </div>
  );
}

const SHOWN = 8;

/**
 * One breakdown as grouped rows, like the Goals list: what it is and what it cost on the first line, how much time,
 * how many sessions and tokens on the second. Cost is Claude Code's alone: — for a row without Claude Code, * when it
 * leaves sessions out (Codex or Antigravity ones, or Claude Code ones cut before a cost was reported).
 */
function Breakdown({ title, rows }: { title: string; rows: ActivityRow[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <Card title={title}>
      {/* the rows run edge to edge: the card's own padding is taken back */}
      {rows.length === 0 ? (
        <EmptyState size="card" icon={Activity} title="Nothing yet">
          A row shows once a session has run in the last 7 days.
        </EmptyState>
      ) : (
        <div className="-m-4">
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id} className={cn(BOARD_ROW, 'min-w-0 px-4 py-2.5')}>
                <div className="flex items-center gap-1.5 min-w-0 text-[13px]">
                  {r.agents.map((a) => (
                    <ProviderBadge key={a} provider={a} compact />
                  ))}
                  {r.goalId ? (
                    <Link className="-my-1.5 truncate py-1.5 font-semibold text-ink hover:underline" to={`/goals/${r.goalId}`} title={r.label}>
                      {r.label}
                    </Link>
                  ) : (
                    <span className={cn('truncate font-semibold', r.muted ? 'text-ink-faint' : 'text-ink')} title={r.label}>
                      {r.label}
                    </span>
                  )}
                  <span className="ml-auto pl-2 mono shrink-0 font-semibold text-ink">
                    {r.costUsd == null ? (
                      <span className="font-normal text-ink-faint" title={`${r.agents.map((a) => PROVIDER_NAME[a]).join(' and ')} report${r.agents.length === 1 ? 's' : ''} no dollar cost`}>—</span>
                    ) : (
                      <span title={r.partial ? partialNote(r) : 'estimated cost'}>
                        {fmtUsd(r.costUsd)}
                        {r.partial && <span className="text-ink-faint">*</span>}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] text-ink-faint">
                  {r.state && <Badge state={r.state} />}
                  <span className="mono text-ink-soft">{fmtSpan(r.durationMs)}</span>
                  <span>· {r.sessions} session{r.sessions === 1 ? '' : 's'}</span>
                  <span title={`input ${fmtK(r.tokens.input)} · cache read ${fmtK(r.tokens.cacheRead)} · cache write ${fmtK(r.tokens.cacheCreate)} · output ${fmtK(r.tokens.output)}`}>· {fmtK(totalTokens(r))} tokens</span>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > SHOWN && (
            <button type="button" className="w-full py-2 text-xs font-semibold text-ink-faint hover:text-ink border-t border-line" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

/** one breakdown row for every coding agent: time and tokens from all, cost from Claude Code only */
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
  /** the cost leaves sessions out: Codex or Antigravity ones (no dollar cost) or Claude Code ones cut before a cost was reported */
  partial: boolean;
  /** Claude Code sessions cut before a cost was reported: unknown, not $0 */
  unmeasured: number;
}

/** why a row's cost is marked *: which of its sessions it leaves out */
function partialNote(r: ActivityRow): string {
  const parts: string[] = [];
  const others = r.agents.filter((a) => !reportsDollars(a));
  if (others.length) parts.push(`its ${others.map((a) => PROVIDER_NAME[a]).join(' and ')} sessions report no dollar cost`);
  if (r.unmeasured > 0) parts.push(`${r.unmeasured} Claude Code session${r.unmeasured === 1 ? '' : 's'} ended before a cost was reported (unknown, not $0)`);
  return `This row's cost leaves sessions out: ${parts.join('; ')}`;
}

type Part = { sessions: number; costUsd: number; unmeasured?: number; durationMs?: number; avgDurationMs?: number; inputTokens?: number; cacheReadTokens?: number; cacheCreateTokens?: number; outputTokens?: number };

/** Every agent's 7-day breakdowns as one; Codex and Antigravity contribute sessions, time and tokens but no cost. */
export function mergeActivity(both: Partial<Record<AgentProvider, Pick<Usage, 'sevenDay' | 'byGoal' | 'byKind' | 'byModel' | 'totals'>>>) {
  const parts = AGENT_PROVIDERS.flatMap((p) => (both[p] ? [{ p, u: both[p]! }] : []));
  const merge = (map: Map<string, ActivityRow>, id: string, base: Pick<ActivityRow, 'label' | 'goalId' | 'state' | 'muted'>, p: AgentProvider, x: Part) => {
    const row = map.get(id) ?? { id, ...base, agents: [], sessions: 0, durationMs: 0, tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 }, costUsd: null, partial: false, unmeasured: 0 };
    if (!row.agents.includes(p)) row.agents.push(p);
    row.sessions += x.sessions;
    // summaries from before time totals existed carry an average instead
    row.durationMs += x.durationMs ?? (x.avgDurationMs ?? 0) * x.sessions;
    row.tokens.input += x.inputTokens ?? 0;
    row.tokens.cacheRead += x.cacheReadTokens ?? 0;
    row.tokens.cacheCreate += x.cacheCreateTokens ?? 0;
    row.tokens.output += x.outputTokens ?? 0;
    if (p === 'claude') {
      row.costUsd = (row.costUsd ?? 0) + x.costUsd;
      row.unmeasured += x.unmeasured ?? 0;
    }
    row.partial = row.costUsd != null && (row.agents.length > 1 || row.unmeasured > 0);
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
    unmeasuredSessions: both.claude?.totals.unmeasuredSessions ?? 0,
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
          <span className="text-xs text-ink-faint">checked {new Date(q.checkedAt).toLocaleTimeString()}</span>
          <Button size="sm" disabled={busy} onClick={() => load(true)} title="Runs mmx quota show">
            <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> Refresh
          </Button>
        </>
      }
    >
      {q.state === 'unavailable' && (
        <div className="text-xs text-ink-soft">
          mmx is installed but has no key. Add one under <Link className="underline" to="/settings#tools">Settings → Tools &amp; keys</Link>, or run <span className="mono">mmx auth login</span>.
        </div>
      )}
      {q.state === 'error' && <div className="text-xs text-bad-ink">{q.message}</div>}
      {/* how it stands against its limit: green while there is enough, a low balance or window is yours to top up (the
          yellow of the top bar's dot) */}
      {q.state === 'balance' && (
        <div>
          <div className={LABEL}>pay-as-you-go balance available</div>
          <div className={cn('mt-1 text-2xl font-bold mono', q.low ? 'text-you-ink' : 'text-ok-ink')}>{q.available.toFixed(2)}</div>
        </div>
      )}
      {q.state === 'plan' && (
        <div className="space-y-3">
          {q.models.length === 0 && <div className="text-xs text-ink-faint">no models in this plan</div>}
          {q.models.map((m) => (
            <div key={m.name} className="text-xs">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-semibold text-ink truncate flex-1">{m.name}</span>
                <span className="mono font-semibold text-ink">{m.remainingPercent == null ? '—' : `${m.remainingPercent}% left`}</span>
                {m.weeklyRemainingPercent != null && <span className="text-ink-faint">· week {m.weeklyRemainingPercent}%</span>}
                {m.resetsAt && <span className="text-ink-faint">· resets in {untilText(m.resetsAt)}</span>}
              </div>
              <div className="h-1.5 rounded-xs bg-line overflow-hidden">
                <div className={cn('h-full', (m.remainingPercent ?? 100) < 10 ? 'bg-you' : 'bg-ok')} style={{ width: `${Math.max(0, Math.min(100, m.remainingPercent ?? 0))}%` }} />
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
  if (!reportsDollars(provider)) return <div className="space-y-2">
    <p className="text-xs text-ink-faint">Local activity over the last 7 days. This reporting period is not an account limit.</p>
    <WindowCard showSignal={false} costAvailable={false} w={{ ...u.sevenDay, label: 'Foundry activity · last 7 days' }} series={u.series.daily} now={u.now} />
  </div>;
  // side by side from a wide screen on: a tablet's half is too narrow for a chart's hours
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
        <span className="flex flex-wrap items-center gap-2">
          {w.label}
          {/* how the window stands against its limit, in its signal; with no signal from the account it is not known: hollow */}
          {showSignal && (w.status ? <Badge state={state}>{signalLabel(w.status)}</Badge> : <Unknown>{w.lastSignalAt ? 'no current signal' : 'no signal yet'}</Unknown>)}
          {showSignal && w.isUsingOverage && <Badge state="warn">overage</Badge>}
        </span>
      }
      actions={<span className="text-xs text-ink-faint">{showSignal ? (w.resetsAt ? (Date.parse(w.resetsAt) > Date.parse(now) ? `resets in ${untilText(w.resetsAt)}` : 'rolled over — next signal sets the window') : 'no reset signal yet') : 'Foundry activity'}</span>}
    >
      <div className="flex items-end gap-x-6 gap-y-3 flex-wrap">
        <div>
          <div className="text-2xl font-bold mono leading-tight text-ink">{costAvailable ? fmtUsd(w.costUsd) : fmtK(w.outputTokens) + ' tokens'}</div>
          <div className="mt-0.5 text-xs text-ink-faint">{w.sessions} session{w.sessions === 1 ? '' : 's'} · {costAvailable ? 'est. cost' : 'output tokens'}</div>
        </div>
        {/* beside the figure where it fits; on a phone a full row of its own under it */}
        <div className="grid grid-cols-3 gap-x-5 max-sm:w-full sm:ml-auto">
          <Stat label="output" value={fmtK(w.outputTokens)} />
          <Stat label="input" value={fmtK(w.inputTokens)} />
          <Stat label="cache read" value={fmtK(w.cacheReadTokens)} />
        </div>
      </div>
      {/* how far through the window: time, not quota, so a quiet bar that never turns a signal colour */}
      {showSignal && <div className="mt-4">
        <div className="flex justify-between gap-3 text-[11px] text-ink-faint mb-1.5">
          <span>window {new Date(start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>{w.resetsAt && Date.parse(w.resetsAt) > Date.parse(now) ? `resets ${new Date(w.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'rolling'}</span>
        </div>
        <div className="h-1 rounded-xs bg-line overflow-hidden" title={`${elapsed.toFixed(0)}% of the window elapsed (time, not quota)`}>
          <div className="h-full bg-ink-faint" style={{ width: `${elapsed}%` }} />
        </div>
      </div>}
      <Bars buckets={series} costAvailable={costAvailable} />
      {showSignal && w.status && SIGNAL[w.status]?.hint && <p className={cn('text-xs mt-3', state === 'warn' ? 'text-you-ink' : 'text-bad-ink')}>{SIGNAL[w.status]!.hint}</p>}
      {showSignal && w.lastSignalAt && <div className="text-[11px] text-ink-faint mt-2">last rate-limit signal {new Date(w.lastSignalAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{!w.status && ' · that window has since reset; Claude sends a new one when this window nears its limit'}</div>}
    </Card>
  );
}

/**
 * Cost per bucket as plain divs, in the blue every chart of spend is drawn in (SERIES); hover shows the detail. A
 * label too long for its bucket on a phone wraps to a second line instead of being cut.
 */
function Bars({ buckets, costAvailable }: { buckets: UsageBucket[]; costAvailable: boolean }) {
  const value = (b: UsageBucket) => costAvailable ? b.costUsd : b.outputTokens;
  const max = Math.max(0.0001, ...buckets.map(value));
  return (
    <div className="mt-4">
      <div className="flex items-end gap-1 h-16 border-b border-line">
        {buckets.map((b) => (
          <div key={b.t} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${b.label}: ${costAvailable ? fmtUsd(b.costUsd) : 'cost unavailable'} · ${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${fmtK(b.outputTokens)} output tokens`}>
            {/* at most 3rem wide: a wide card keeps bars, not blocks of colour */}
            <div className={cn('w-full max-w-12 rounded-t-xs transition-opacity', value(b) > 0 ? cn(SERIES.spend.dot, 'group-hover:opacity-70') : 'bg-line')} style={{ height: `${value(b) > 0 ? Math.max(6, (value(b) / max) * 100) : 2}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {buckets.map((b) => (
          <div key={b.t} className="min-w-0 flex-1 text-center text-[11px] leading-tight text-ink-faint break-words">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** a state that is not known (no signal from the account yet): a hollow tag in the Badge's shape, never a colour */
function Unknown({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft" title="pending">{children}</span>;
}

/** the label of a figure: small capitals over it, as on every page */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] leading-tight text-ink-faint';

/** a figure tile (Usage, Reports): what it counts in small capitals, the figure large under it; `good` and `bad` colour a figure that passes or fails */
export function Kpi({ label, value, hint, good, bad }: { label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-lg border border-line bg-panel px-4 py-3 shadow-[var(--surface-shadow)]" title={hint}>
      <div className={LABEL}>{label}</div>
      <div className={cn('mono text-2xl font-bold leading-none', bad ? 'text-bad-ink' : good ? 'text-ok-ink' : 'text-ink')}>{value}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mono mt-0.5 text-[15px] font-bold text-ink">{value}</div>
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
      const providers = AGENT_PROVIDERS;
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
  const blocked = values.some(u => u.provider === 'codex' ? u.codexQuota?.state === 'available' && u.codexQuota.ordinaryUsageAllowed === false : u.provider === 'agy' ? agyQuotaExhausted(u.agyQuota) : !!u.fiveHour.status && u.fiveHour.status !== 'allowed');
  const attention = paused || blocked || minimaxLow;
  const summaries = AGENT_PROVIDERS.map(provider => {
    const u = usages[provider];
    const name = PROVIDER_LABEL[provider];
    if (!u) return `${name} · usage unavailable`;
    return `${name} · ${u.pausedUntil && Date.parse(u.pausedUntil) > Date.now() ? 'sessions paused · ' : ''}${provider === 'codex' ? codexQuotaSummary(u.codexQuota) : provider === 'agy' ? agyQuotaSummary(u.agyQuota) : `Foundry activity (5h) ${fmtUsd(u.fiveHour.costUsd)}`}`;
  });
  const title = [...summaries, ...(minimaxLow ? ['MiniMax quota low'] : []), 'Open Usage to view each coding agent separately.'].join('\n');
  // in the top bar's own colours, as the Inbox beside it; what needs a look is the yellow dot (the guide calls it amber)
  return <Link to="/usage" aria-label={`Usage across the coding agents${attention ? ' · needs attention' : ''}`} title={title} className={cn('flex h-8 sm:h-7 shrink-0 items-center gap-1.5 rounded-md border border-band-line px-2 text-xs font-semibold hover:bg-band-hover', attention ? 'text-band-ink' : 'text-band-ink-soft hover:text-band-ink')}>
    <Gauge size={14} /><span className="hidden sm:inline">Usage</span>
    {attention && <span className="h-1.5 w-1.5 rounded-full bg-you" aria-hidden="true" />}
  </Link>;
}
