import type { UsageBucket, WindowSummary } from '@foundry/engine/usage-types';
import { Gauge, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Usage } from '../api.ts';
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
  const version = useLive((s) => s.globalVersion);
  const [u, setU] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api.usage().then(setU).catch((e) => setErr(e.message)), 150);
    return () => clearTimeout(t);
  }, [version]);
  const probe = async () => {
    setBusy(true);
    setErr(null);
    try {
      setU(await api.probeUsage());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!u) return <Empty>{err ?? 'Loading usage…'}</Empty>;
  const t = u.totals;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Gauge size={18} /> Claude usage <HelpLink to="costs-and-usage" label="What costs money and how to spend less (new tab)" />
        </h1>
        <span className="text-xs text-zinc-500 hidden md:inline">what Foundry spent on this machine · for your account's percentages run /usage inside Claude Code</span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={probe} title="Runs one tiny haiku session (~$0.02) to refresh the rate-limit signal">
          <RefreshCw size={13} className={cn(busy && 'animate-spin')} /> Refresh signal
        </Button>
        {err && <span className="text-xs text-rose-400 basis-full">{err}</span>}
      </div>
      {u.pausedUntil && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm">
          ⏸ Rate limited — the engine is not starting new sessions and will resume automatically in {untilText(u.pausedUntil)} ({new Date(u.pausedUntil).toLocaleTimeString()}). Goals stay where they are.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WindowCard w={u.fiveHour} series={u.series.hourly} now={u.now} />
        <WindowCard w={u.sevenDay} series={u.series.daily} now={u.now} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="cache hit rate (7d)" value={t.cacheHitRate == null ? '—' : `${(t.cacheHitRate * 100).toFixed(0)}%`} hint="cache-read tokens ÷ all input tokens — higher is cheaper" good={t.cacheHitRate != null && t.cacheHitRate > 0.6} />
        <Kpi label="avg cost / session (7d)" value={t.avgCostPerSession == null ? '—' : fmtUsd(t.avgCostPerSession)} />
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
                  <span className="mono text-zinc-300 w-14 text-right shrink-0">{fmtUsd(g.costUsd)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="By session kind (7d)">
          <Rows rows={u.byKind.map((k) => [k.kind, `${k.sessions}× · ${fmtDur(k.avgDurationMs)}`, fmtUsd(k.costUsd)])} />
        </Card>
        <Card title="By model (7d)">
          <Rows rows={u.byModel.map((m) => [m.model, `${m.sessions}× · ${fmtK(m.outputTokens)} out`, fmtUsd(m.costUsd)])} />
        </Card>
      </div>
      <p className="text-xs text-zinc-500">{u.note}</p>
    </div>
  );
}

/** One rate-limit window: cost, token split, elapsed-time bar with reset countdown, and the cost-per-bucket bars. */
function WindowCard({ w, series, now }: { w: WindowSummary; series: UsageBucket[]; now: string }) {
  const state = !w.status ? 'pending' : w.status === 'allowed' ? 'pass' : w.status === 'allowed_warning' ? 'warn' : 'fail';
  const start = Date.parse(w.windowStart);
  const end = Date.parse(w.windowEnd);
  const elapsed = Math.min(100, Math.max(0, ((Date.parse(now) - start) / Math.max(1, end - start)) * 100));
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {w.label}
          <Badge state={state}>{w.status ?? 'no signal yet'}</Badge>
          {w.isUsingOverage && <Badge state="warn">overage</Badge>}
        </span>
      }
      actions={<span className="text-[11px] text-zinc-500">{w.resetsAt ? (Date.parse(w.resetsAt) > Date.parse(now) ? `resets in ${untilText(w.resetsAt)}` : 'rolled over — next signal sets the window') : 'no reset signal yet'}</span>}
    >
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <div className="text-2xl font-semibold mono text-zinc-100">{fmtUsd(w.costUsd)}</div>
          <div className="text-[11px] text-zinc-500">{w.sessions} session{w.sessions === 1 ? '' : 's'} · est. cost</div>
        </div>
        <div className="grid grid-cols-3 gap-x-4 text-[11px] ml-auto">
          <Stat label="output" value={fmtK(w.outputTokens)} />
          <Stat label="input" value={fmtK(w.inputTokens)} />
          <Stat label="cache read" value={fmtK(w.cacheReadTokens)} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
          <span>window {new Date(start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>{w.resetsAt ? `resets ${new Date(w.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'rolling'}</span>
        </div>
        <div className="h-1.5 rounded bg-zinc-800 overflow-hidden" title={`${elapsed.toFixed(0)}% of the window elapsed (time, not quota)`}>
          <div className="h-full bg-zinc-500" style={{ width: `${elapsed}%` }} />
        </div>
      </div>
      <Bars buckets={series} />
      {w.lastSignalAt && <div className="text-[10px] text-zinc-600 mt-2">last rate-limit signal {new Date(w.lastSignalAt).toLocaleTimeString()}</div>}
    </Card>
  );
}

/** Cost per bucket as plain divs; hover shows the detail. */
function Bars({ buckets }: { buckets: UsageBucket[] }) {
  const max = Math.max(0.0001, ...buckets.map((b) => b.costUsd));
  return (
    <div className="mt-3">
      <div className="flex items-end gap-1 h-16">
        {buckets.map((b) => (
          <div key={b.t} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${b.label}: ${fmtUsd(b.costUsd)} · ${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${fmtK(b.outputTokens)} output tokens`}>
            <div className={cn('w-full rounded-t transition-colors', b.costUsd > 0 ? 'bg-emerald-500/70 group-hover:bg-emerald-400' : 'bg-zinc-800')} style={{ height: `${b.costUsd > 0 ? Math.max(6, (b.costUsd / max) * 100) : 2}%` }} />
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

/** Header pill: 5h status + reset countdown + window cost. */
export function UsagePill() {
  const version = useLive((s) => s.globalVersion);
  const [u, setU] = useState<Usage | null>(null);
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
  const w = u.fiveHour;
  const color = u.pausedUntil ? 'text-amber-300 border-amber-500/40' : w.status === 'allowed' || !w.status ? 'text-zinc-300 border-zinc-700' : 'text-rose-300 border-rose-500/40';
  return (
    <Link to="/usage" className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] mono', color)} title={u.note}>
      <Gauge size={12} />
      <span className="whitespace-nowrap">{u.pausedUntil ? `paused ${untilText(u.pausedUntil)}` : `5h ${fmtUsd(w.costUsd)}`}</span>
      {w.resetsAt && !u.pausedUntil && <span className="text-zinc-500 hidden lg:inline whitespace-nowrap">· reset {untilText(w.resetsAt)}</span>}
    </Link>
  );
}
