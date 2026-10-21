import type { Report, ReportEstimate, ReportFactor } from '@foundry/engine/usage-types';
import { BarChart3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { ButtonGroup, Card, Empty, Page, cn, fmtUsd } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

type Window = '30' | '90' | '365' | 'all';
const WINDOWS: { id: Window; label: string; title: string }[] = [
  { id: '30', label: '30 days', title: 'The last 30 days, by day' },
  { id: '90', label: '90 days', title: 'The last 90 days, by week' },
  { id: '365', label: '12 months', title: 'The last 12 months, by week' },
  { id: 'all', label: 'All time', title: 'Everything on record' },
];

/** what the ledger's session kinds are called on the page (ADR-0060) */
export const KIND_LABEL: Record<string, string> = {
  attempt: 'Workers on tasks',
  'review-task': 'Task reviews',
  clarify: 'Clarify',
  planner: 'Planning',
  replan: 'Replanning',
  'review-goal': 'Goal reviews',
  merge: 'Merge attempts',
  audit: 'Audits',
  qa: 'Browser QA',
  docs: 'Docs',
  walkthrough: 'Walkthroughs',
  likeness: 'Likeness reviews',
  feedback: 'Feedback',
  suggest: 'Suggestions',
  'second-opinion': 'Second opinions',
  investigation: 'Reference studies',
  'subject-search': 'Subject searches',
  'style-sample': 'Style samples',
  distill: 'Learnings',
  learnings: 'Learnings',
  probe: 'Probes',
};
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

const fmtMin = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(min < 600 ? 1 : 0)} h`);
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const factor = (f: ReportFactor | null) => (f ? `×${f.factor}` : '—');
const factors = (e: ReportEstimate) => (e.cost || e.time ? `${factor(e.cost)} / ${factor(e.time)}` : '—');
/** what a spend leaves out */
const partial = (s: { unmeasured: number; codexSessions: number }) =>
  [s.unmeasured ? `${s.unmeasured} Claude Code session${s.unmeasured === 1 ? '' : 's'} with unknown cost left out` : '', s.codexSessions ? `${s.codexSessions} Codex or Antigravity session${s.codexSessions === 1 ? '' : 's'} report no cost` : ''].filter(Boolean).join('; ');

/** Reports (ADR-0060): what Foundry cost and did over a window, by project and by session kind. */
export function ReportsPage() {
  const version = useLive((s) => s.globalVersion);
  const [win, setWin] = useState<Window>('30');
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .report(win === 'all' ? null : Number(win))
      .then((r) => current && setReport(r))
      .catch((e) => current && setErr(e.message));
    return () => {
      current = false;
    };
  }, [win, version]);
  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 size={18} /> Reports <HelpLink to="costs-and-usage" />
        </h1>
        <ButtonGroup label="Window" value={win} onChange={setWin} options={WINDOWS} />
        <Link to="/usage" className="text-xs underline text-zinc-400 sm:ml-auto">
          The last 7 days and the account limits: Usage
        </Link>
      </div>
      {err && <div className="text-sm text-rose-300">{err}</div>}
      {report ? <ReportView report={report} /> : !err && <div className="text-sm text-zinc-500">Reading the records…</div>}
    </Page>
  );
}

/** The report itself: the numbers at the top, the spend over time, the projects, the session kinds, the estimate misses. */
export function ReportView({ report: r }: { report: Report }) {
  const t = r.totals;
  if (!t.sessions && !t.goals.total) return <Empty>Nothing ran in this window. Goals count by when they were created, sessions by when they ran.</Empty>;
  const maxCost = Math.max(0, ...r.series.map((b) => b.costUsd));
  const maxSessions = Math.max(0, ...r.series.map((b) => b.sessions));
  const byCost = maxCost > 0;
  const every = r.series.length > 16 ? Math.ceil(r.series.length / 8) : 1;
  const starved = partial(t);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="spend" value={fmtUsd(t.costUsd)} hint={`Claude Code estimates${starved ? `; ${starved}` : ''}`} />
        <Kpi label="sessions" value={String(t.sessions)} hint={`${fmtMin(t.durationMs / 60_000)} in sessions`} />
        <Kpi label="goals finished" value={`${t.goals.finished} / ${t.goals.total}`} hint={`of the goals started in the window: ${t.goals.failed} failed, ${t.goals.cancelled} cancelled, ${t.goals.open} still open`} bad={t.goals.failed > 0} />
        <Kpi label="hours worked" value={fmtMin(t.activeMin)} hint="Foundry's working time on those goals, waits for you left out" />
        <Kpi label="retry rate" value={pct(t.retries.rate)} hint={`${t.retries.retried} of ${t.retries.tasks} attempted tasks needed more than one attempt (${t.retries.attempts} attempts); ${t.retries.fixTasks} fix task${t.retries.fixTasks === 1 ? '' : 's'}`} bad={t.retries.rate != null && t.retries.rate > 0.3} />
        <Kpi label="estimate error" value={factors(t.estimate)} hint={`actual ÷ the Brief's estimate, the median over ${t.estimate.samples} goal${t.estimate.samples === 1 ? '' : 's'} with one: cost / time`} />
      </div>

      <Card title={`Spend over time · by ${r.step}`}>
        {r.series.length ? (
          <div>
            <div className="flex items-end gap-px h-28" role="img" aria-label="spend per bucket">
              {r.series.map((b) => {
                const v = byCost ? b.costUsd / maxCost : maxSessions ? b.sessions / maxSessions : 0;
                return (
                  <div key={b.t} className="flex-1 min-w-0 flex flex-col justify-end h-full" title={`${b.label}: ${fmtUsd(b.costUsd)} · ${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${b.finished} finished`}>
                    <div className={cn('rounded-t', b.finished ? 'bg-emerald-500/70' : 'bg-sky-500/60')} style={{ height: `${Math.max(v * 100, b.sessions ? 3 : 0)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-px text-[10px] text-zinc-500 mt-1">
              {r.series.map((b, i) => (
                <div key={b.t} className="flex-1 min-w-0 whitespace-nowrap overflow-visible">
                  {i % every === 0 ? b.label : ''}
                </div>
              ))}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1">{byCost ? 'Bars are Claude Code dollars' : 'No dollars in the window, so bars are sessions'}; a green bar had a goal finish in it. Hover a bar for its numbers.</div>
          </div>
        ) : (
          <Empty>No sessions in the window.</Empty>
        )}
      </Card>

      <Card title="By project" bodyClassName="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-zinc-500">
            <tr>
              <th className="text-left px-4 py-2">project</th>
              <th className="text-right px-2 py-2" title="finished / started in the window">goals</th>
              <th className="text-right px-2 py-2">spend</th>
              <th className="text-right px-2 py-2" title="the average cost of a finished Claude Code goal">per goal</th>
              <th className="text-right px-2 py-2" title="Foundry's working time, waits for you left out">hours</th>
              <th className="text-right px-2 py-2" title="attempted tasks that needed more than one attempt">retries</th>
              <th className="text-right px-4 py-2" title="actual ÷ the Brief's estimate: cost / time">estimate</th>
            </tr>
          </thead>
          <tbody>
            {r.repos.map((p) => (
              <tr key={p.repoPath} className="border-t border-zinc-800">
                <td className="px-4 py-1.5">
                  <span className="mono text-zinc-200" title={p.repoPath}>{p.name}</span>
                </td>
                <td className="text-right px-2 py-1.5 mono text-zinc-300 whitespace-nowrap" title={`${p.goals.failed} failed · ${p.goals.cancelled} cancelled · ${p.goals.open} still open`}>
                  {p.goals.finished} / {p.goals.total}
                  {p.goals.failed ? <span className="text-rose-300"> · {p.goals.failed} failed</span> : null}
                </td>
                <td className="text-right px-2 py-1.5 mono text-zinc-200" title={partial(p) || undefined}>{fmtUsd(p.costUsd)}{partial(p) ? '*' : ''}</td>
                <td className="text-right px-2 py-1.5 mono text-zinc-400">{p.costPerFinishedGoal == null ? '—' : fmtUsd(p.costPerFinishedGoal)}</td>
                <td className="text-right px-2 py-1.5 mono text-zinc-400 whitespace-nowrap">{fmtMin(p.activeMin)}</td>
                <td className="text-right px-2 py-1.5 mono text-zinc-400" title={`${p.retries.retried} of ${p.retries.tasks} attempted tasks · ${p.retries.fixTasks} fix task${p.retries.fixTasks === 1 ? '' : 's'}`}>{pct(p.retries.rate)}</td>
                <td className="text-right px-4 py-1.5 mono text-zinc-400 whitespace-nowrap" title={`${p.estimate.samples} goal${p.estimate.samples === 1 ? '' : 's'} with an estimate`}>{factors(p.estimate)}</td>
              </tr>
            ))}
            {t.noGoal.sessions > 0 && (
              <tr className="border-t border-zinc-800 text-zinc-500">
                <td className="px-4 py-1.5">no goal (probes, setup, goals since deleted)</td>
                <td className="text-right px-2 py-1.5">—</td>
                <td className="text-right px-2 py-1.5 mono">{fmtUsd(t.noGoal.costUsd)}</td>
                <td colSpan={4} className="text-right px-4 py-1.5">{t.noGoal.sessions} session{t.noGoal.sessions === 1 ? '' : 's'}</td>
              </tr>
            )}
          </tbody>
        </table>
        {r.repos.some((p) => partial(p)) && <div className="px-4 py-2 text-[11px] text-zinc-500">* a spend that leaves sessions out: Codex or Antigravity sessions, or Claude Code sessions with unknown cost (hover for which).</div>}
      </Card>

      <Card title="Where the budget goes">
        <ul className="space-y-1.5 text-xs">
          {r.kinds.map((k) => (
            <li key={k.kind} className="grid grid-cols-[9rem_1fr_auto] sm:grid-cols-[11rem_1fr_auto] items-center gap-2">
              <span className="text-zinc-300 truncate" title={k.kind}>{kindLabel(k.kind)}</span>
              <span className="flex flex-col gap-0.5">
                <span className="block h-1.5 rounded bg-emerald-500/60" style={{ width: `${Math.round((k.costShare ?? 0) * 100)}%` }} title={`${pct(k.costShare)} of the dollars`} />
                <span className="block h-1.5 rounded bg-sky-500/60" style={{ width: `${Math.round(k.timeShare * 100)}%` }} title={`${pct(k.timeShare)} of the time`} />
              </span>
              <span className="mono text-zinc-400 whitespace-nowrap text-[11px]">{fmtUsd(k.costUsd)} · {pct(k.costShare)} of $ · {pct(k.timeShare)} of time · {k.sessions}×</span>
            </li>
          ))}
        </ul>
        <div className="text-[11px] text-zinc-500 mt-2">Green: the share of the Claude Code dollars. Blue: the share of the session time, which both coding agents report.</div>
      </Card>

      <Card title="Estimate misses">
        {r.misses.length ? (
          <ul className="space-y-1 text-xs">
            {r.misses.map((m) => (
              <li key={m.goalId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <Link to={`/goals/${m.goalId}`} className="underline text-zinc-200 truncate max-w-[24rem]">{m.title}</Link>
                <span className="mono text-zinc-500">{m.repo}</span>
                <span className="mono text-zinc-400">cost {fmtUsd(m.estimateUsd)} → {m.actualUsd == null ? '—' : fmtUsd(m.actualUsd)}{m.costFactor != null ? ` (×${m.costFactor})` : ''}</span>
                <span className="mono text-zinc-400">time {m.estimateMin} min → {m.actualMin == null ? '—' : `${Math.round(m.actualMin)} min`}{m.timeFactor != null ? ` (×${m.timeFactor})` : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No finished goal with an estimate in the window.</Empty>
        )}
        <div className="text-[11px] text-zinc-500 mt-2">Furthest from the Brief's estimate first, too much or too little. The medians above are what calibration corrects new estimates with.</div>
      </Card>
      <p className="text-xs text-zinc-500">{r.note}</p>
    </div>
  );
}

function Kpi({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2" title={hint}>
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className={cn('mono text-lg', bad ? 'text-rose-300' : 'text-zinc-100')}>{value}</div>
    </div>
  );
}
