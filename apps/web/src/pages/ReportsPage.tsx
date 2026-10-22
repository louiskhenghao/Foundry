import type { Report, ReportEstimate, ReportFactor } from '@foundry/engine/usage-types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { BOARD_HEAD, ButtonGroup, Card, Empty, PageHeader, cn, fmtUsd } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';
import { Kpi } from './UsagePage.tsx';

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
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader
        title="Reports"
        help={<HelpLink to="costs-and-usage" />}
        summary={
          <Link to="/usage" className="underline underline-offset-2 hover:text-ink">
            The last 7 days and the account limits: Usage
          </Link>
        }
        actions={<ButtonGroup label="Window" value={win} onChange={setWin} options={WINDOWS} />}
      />
      {err && <div className="text-sm text-bad-ink">{err}</div>}
      {report ? <ReportView report={report} /> : !err && <div className="text-sm text-ink-faint">Reading the records…</div>}
    </div>
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

      {/* spend in ink like everything the agents do; green only where a goal finished */}
      <Card title={`Spend over time · by ${r.step}`}>
        {r.series.length ? (
          <div>
            <div className="flex items-end gap-px h-28 border-b border-line" role="img" aria-label="spend per bucket">
              {r.series.map((b) => {
                const v = byCost ? b.costUsd / maxCost : maxSessions ? b.sessions / maxSessions : 0;
                return (
                  <div key={b.t} className="group flex-1 min-w-0 flex flex-col justify-end h-full" title={`${b.label}: ${fmtUsd(b.costUsd)} · ${b.sessions} session${b.sessions === 1 ? '' : 's'} · ${b.finished} finished`}>
                    <div className={cn('rounded-t-xs transition-opacity group-hover:opacity-70', b.finished ? 'bg-ok' : 'bg-ink')} style={{ height: `${Math.max(v * 100, b.sessions ? 3 : 0)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-px text-[10px] text-ink-faint mt-1.5">
              {r.series.map((b, i) => (
                <div key={b.t} className="flex-1 min-w-0 whitespace-nowrap overflow-visible">
                  {i % every === 0 ? b.label : ''}
                </div>
              ))}
            </div>
            <div className="text-xs text-ink-faint mt-2">{byCost ? 'Bars are Claude Code dollars' : 'No dollars in the window, so bars are sessions'}; a green bar had a goal finish in it. Hover a bar for its numbers.</div>
          </div>
        ) : (
          <Empty>No sessions in the window.</Empty>
        )}
      </Card>

      <Card title="By project">
        {/* edge to edge (the card's padding taken back); a phone scrolls the table sideways inside the card */}
        <div className="-m-4">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className={BOARD_HEAD}>
                  <th className="text-left font-extrabold px-4 py-2.5">project</th>
                  <th className="text-right font-extrabold px-2 py-2.5" title="finished / started in the window">goals</th>
                  <th className="text-right font-extrabold px-2 py-2.5">spend</th>
                  <th className="text-right font-extrabold px-2 py-2.5" title="the average cost of a finished Claude Code goal">per goal</th>
                  <th className="text-right font-extrabold px-2 py-2.5" title="Foundry's working time, waits for you left out">hours</th>
                  <th className="text-right font-extrabold px-2 py-2.5" title="attempted tasks that needed more than one attempt">retries</th>
                  <th className="text-right font-extrabold px-4 py-2.5" title="actual ÷ the Brief's estimate: cost / time">estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.repos.map((p) => (
                  <tr key={p.repoPath} className="transition-colors hover:bg-sunken">
                    <td className="px-4 py-2.5">
                      <span className="mono font-bold text-ink" title={p.repoPath}>{p.name}</span>
                    </td>
                    <td className="text-right px-2 py-2.5 mono text-ink whitespace-nowrap" title={`${p.goals.failed} failed · ${p.goals.cancelled} cancelled · ${p.goals.open} still open`}>
                      {p.goals.finished} / {p.goals.total}
                      {p.goals.failed ? <span className="text-bad-ink"> · {p.goals.failed} failed</span> : null}
                    </td>
                    <td className="text-right px-2 py-2.5 mono font-semibold text-ink" title={partial(p) || undefined}>{fmtUsd(p.costUsd)}{partial(p) ? '*' : ''}</td>
                    <td className="text-right px-2 py-2.5 mono text-ink-soft">{p.costPerFinishedGoal == null ? '—' : fmtUsd(p.costPerFinishedGoal)}</td>
                    <td className="text-right px-2 py-2.5 mono text-ink-soft whitespace-nowrap">{fmtMin(p.activeMin)}</td>
                    <td className="text-right px-2 py-2.5 mono text-ink-soft" title={`${p.retries.retried} of ${p.retries.tasks} attempted tasks · ${p.retries.fixTasks} fix task${p.retries.fixTasks === 1 ? '' : 's'}`}>{pct(p.retries.rate)}</td>
                    <td className="text-right px-4 py-2.5 mono text-ink-soft whitespace-nowrap" title={`${p.estimate.samples} goal${p.estimate.samples === 1 ? '' : 's'} with an estimate`}>{factors(p.estimate)}</td>
                  </tr>
                ))}
                {t.noGoal.sessions > 0 && (
                  <tr className="text-ink-faint">
                    <td className="px-4 py-2.5">no goal (probes, setup, goals since deleted)</td>
                    <td className="text-right px-2 py-2.5">—</td>
                    <td className="text-right px-2 py-2.5 mono">{fmtUsd(t.noGoal.costUsd)}</td>
                    <td colSpan={4} className="text-right px-4 py-2.5">{t.noGoal.sessions} session{t.noGoal.sessions === 1 ? '' : 's'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {r.repos.some((p) => partial(p)) && <div className="border-t border-line px-4 py-2.5 text-xs text-ink-faint">* a spend that leaves sessions out: Codex or Antigravity sessions, or Claude Code sessions with unknown cost (hover for which).</div>}
        </div>
      </Card>

      {/* two bars per kind, both in ink: the dollars solid on top, the time paler under them */}
      <Card title="Where the budget goes">
        <ul className="space-y-3 text-[13px]">
          {r.kinds.map((k) => (
            <li key={k.kind} className="grid grid-cols-[minmax(0,8rem)_1fr] sm:grid-cols-[11rem_1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-ink truncate" title={k.kind}>{kindLabel(k.kind)}</span>
              <span className="flex flex-col gap-1">
                <span className="block h-1.5 rounded-xs bg-ink" style={{ width: `${Math.round((k.costShare ?? 0) * 100)}%` }} title={`${pct(k.costShare)} of the dollars`} />
                <span className="block h-1.5 rounded-xs bg-ink/35" style={{ width: `${Math.round(k.timeShare * 100)}%` }} title={`${pct(k.timeShare)} of the time`} />
              </span>
              <span className="col-span-2 sm:col-span-1 mono text-ink-soft sm:whitespace-nowrap text-xs">{fmtUsd(k.costUsd)} · {pct(k.costShare)} of $ · {pct(k.timeShare)} of time · {k.sessions}×</span>
            </li>
          ))}
        </ul>
        <div className="text-xs text-ink-faint mt-3">Top bar: the share of the Claude Code dollars. Bottom bar: the share of the session time, which both coding agents report.</div>
      </Card>

      <Card title="Estimate misses">
        {r.misses.length ? (
          <ul className="-my-1 divide-y divide-line text-[13px]">
            {r.misses.map((m) => (
              <li key={m.goalId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <Link to={`/goals/${m.goalId}`} className="font-semibold text-ink underline underline-offset-2 truncate max-w-[24rem]">{m.title}</Link>
                <span className="mono text-xs text-ink-faint">{m.repo}</span>
                <span className="mono text-xs text-ink-soft">cost {fmtUsd(m.estimateUsd)} → {m.actualUsd == null ? '—' : fmtUsd(m.actualUsd)}{m.costFactor != null ? ` (×${m.costFactor})` : ''}</span>
                <span className="mono text-xs text-ink-soft">time {m.estimateMin} min → {m.actualMin == null ? '—' : `${Math.round(m.actualMin)} min`}{m.timeFactor != null ? ` (×${m.timeFactor})` : ''}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No finished goal with an estimate in the window.</Empty>
        )}
        <div className="text-xs text-ink-faint mt-3">Furthest from the Brief's estimate first, too much or too little. The medians above are what calibration corrects new estimates with.</div>
      </Card>
      <p className="text-xs text-ink-faint">{r.note}</p>
    </div>
  );
}
