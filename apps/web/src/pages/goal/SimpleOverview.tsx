import { PROVIDER_LABEL, reportsDollars, unmeasuredSessions } from '@foundry/core/browser';
import { CutSessionsDot } from '../../components/CutSessionsDot.tsx';
import { MergeStatus } from '../../components/MergeStatus.tsx';
import { Check, FileText, Hand, PartyPopper } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GoalDetail } from '../../api.ts';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { TaskSquares, markFill, taskMark, type Mark } from '../../components/progress.tsx';
import { Badge, Button, Card, NEEDS_YOU_CARD, YouStrip, cn, fmtLimitMin, fmtLimitUsd, fmtUsd } from '../../ui.tsx';
import { EscalationCard } from '../InboxPage.tsx';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { MilestonesCard } from './MilestoneEvidence.tsx';
import { BriefStrip, GoalReview } from './OverviewTab.tsx';
import { PreviewCard } from './PreviewCard.tsx';

const STATE_TEXT: Record<string, string> = {
  draft: 'Getting ready.',
  clarifying: 'Reading your repository and writing the plan — a few minutes.',
  awaiting_brief_approval: 'The plan is ready for you to read and approve.',
  running: 'Working.',
  blocked: 'Paused — something needs you (see below).',
  awaiting_feedback: 'A milestone landed — have a look above, then continue or say what to change.',
  goal_review: 'Everything is built; checking the whole result now.',
  done: 'Done. Everything you asked for passes its checks.',
  over_delivered: 'Done — and the extras passed too.',
  failed: 'Stopped: some parts could not be finished.',
  cancelled: 'Cancelled.',
};
/** the squares in a row read finished first, as on the Goals page */
const MARK_ORDER: Mark[] = ['done', 'run', 'you', 'bad', 'next', 'off'];
/** a figure's label, in small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';
/** the progress bar in the goal's signal colour: green once done, red when it stopped failed, grey when cancelled, blue while at work */
const BAR: Record<string, string> = { done: 'bg-ok', over_delivered: 'bg-ok', failed: 'bg-bad', cancelled: 'bg-line-strong' };

/**
 * Progress for people who do not want the machinery: what is happening, how far, what it costs, what needs them, and
 * what there is to see — the preview, every milestone's walkthrough, the verdict — with what they asked for at the end.
 * Where things stand reads in large type; what needs them comes as the yellow strips of the Inbox; the pieces of work
 * are squares, the cost and the time are figures.
 */
export function SimpleOverview({ d, onDeliver }: { d: GoalDetail; onDeliver: () => void }) {
  const g = d.goal;
  const unmeasured = unmeasuredSessions(d.attempts);
  const total = d.tasks.length;
  const done = d.tasks.filter((t) => t.state === 'done' || t.state === 'skipped').length;
  const running = d.tasks.filter((t) => t.state === 'running' || t.state === 'observing' || t.state === 'merging');
  const open = d.escalations.filter((e) => e.state === 'open');
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const pct = total ? Math.round((done / total) * 100) : g.state === 'clarifying' ? 5 : 0;
  const approved = !['draft', 'clarifying', 'awaiting_brief_approval'].includes(g.state);
  const review = [...d.events].reverse().find((e) => e.type === 'review.goal.finished')?.payload as { passed: boolean; overDelivered: boolean; notes: string } | undefined;
  const marks = d.tasks.map((t) => taskMark(t.state)).sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b));
  const share = (v: number, max: number | null) => (max ? (v / max) * 100 : null);
  return (
    <div className="space-y-5">
      <p className="max-w-[60ch] text-xl sm:text-2xl font-bold leading-snug tracking-[-0.015em] text-ink">{STATE_TEXT[g.state] ?? g.state}</p>

      {open.length > 0 && (
        <section aria-labelledby="simple-needs-you" className="space-y-3">
          <h2 id="simple-needs-you" className="flex items-center gap-2.5 text-[12.5px] font-extrabold caps text-ink">
            <Hand size={14} aria-hidden="true" />
            Needs you
            <b className="mono grid h-5 min-w-5 place-items-center rounded-[5px] bg-you px-1.5 text-xs tracking-normal text-on-you">{open.length}</b>
          </h2>
          {open.map((e) => (
            <EscalationCard key={e.id} e={{ ...e, taskTitle: d.tasks.find((t) => t.id === e.taskId)?.title ?? null }} embedded />
          ))}
        </section>
      )}

      {g.state === 'awaiting_brief_approval' && (
        <section className={NEEDS_YOU_CARD}>
          <YouStrip
            icon={FileText}
            title="Read the plan and say go."
            since={g.updatedAt}
            aside={
              <Link to={`/goals/${g.id}/brief`}>
                <Button size="sm" variant="primary">Read the plan →</Button>
              </Link>
            }
          />
        </section>
      )}

      {total > 0 && (
        <Card title="Progress">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="flex items-baseline gap-2">
              {/* the count turns green once every piece is done */}
              <b className={cn('mono text-2xl font-bold leading-none', done === total ? 'text-ok-ink' : 'text-ink')}>{done}/{total}</b>
              <span className="text-sm text-ink-soft">pieces</span>
            </div>
            {/* the squares a size up from a list row's: here they are the progress itself */}
            <TaskSquares marks={marks} max={40} className="gap-1 pb-0.5 [&>i]:h-4 [&>i]:w-4 [&>i]:rounded-[4px]" />
          </div>
          <span className="mt-3 block h-1.5 overflow-hidden rounded-xs bg-line" aria-hidden="true">
            <i className={cn('block h-full rounded-xs', BAR[g.state] ?? 'bg-work')} style={{ width: `${pct}%` }} />
          </span>
          {running.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-sm text-ink">
              {running.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {/* under way: the flowing hatch of running work */}
                  <i className={cn('block h-3 w-3 shrink-0 rounded-[3px]', markFill.run)} aria-hidden="true" />
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-xs text-ink-faint">{t.state === 'merging' ? 'combining with the rest' : t.state === 'observing' ? 'checking' : 'in progress'}</span>
                </li>
              ))}
            </ul>
          )}
          {d.tasks.some((t) => t.state === 'blocked') && <div className="mt-3 text-[13px] font-semibold text-you-ink">{d.tasks.filter((t) => t.state === 'blocked').length} piece(s) waiting for you — see above.</div>}
        </Card>
      )}

      {/* at a milestone pause the Have a look card above has the preview already */}
      {approved && g.state !== 'awaiting_feedback' && <PreviewCard goalId={g.id} goal={g} />}
      {approved && <MilestonesCard d={d} />}

      <Card title="Cost">
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {!reportsDollars(g.provider) ? (
            <div>
              <div className={LABEL}>Spent</div>
              <p className="mt-1.5 text-sm text-ink-soft">{PROVIDER_LABEL[g.provider ?? 'claude']} · dollar cost unavailable</p>
            </div>
          ) : (
            <Figure label="Spent" value={fmtUsd(g.costUsd)} limit={fmtLimitUsd(g.budgets.maxCostUsd)} pct={share(g.costUsd, g.budgets.maxCostUsd)} note={unmeasured > 0 && <CutSessionsDot n={unmeasured} est={d.costEstimate} />} />
          )}
          <Figure label="Worked" value={`${d.budget.elapsedMin.toFixed(0)} min`} limit={fmtLimitMin(g.budgets.maxDurationMin)} pct={share(d.budget.elapsedMin, g.budgets.maxDurationMin)}>
            <p className="mt-1.5 text-xs text-ink-faint">(waiting for you not counted)</p>
          </Figure>
        </div>
      </Card>

      {finished && (
        <Card title="Result">
          {g.completion.artifactsRun && (
            <div className={cn('mb-3 flex items-start gap-2 text-sm', g.completion.artifactsRun.status === 'ok' ? 'text-ok-ink' : 'text-ink-soft')}>
              {g.completion.artifactsRun.status === 'ok' ? (
                <>
                  <PartyPopper size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {g.completion.artifactsRun.files.length} file(s) are in <span className="mono">{g.completion.artifactsRun.dest}</span> — open the folder and have a look.
                  </span>
                </>
              ) : (
                <>{g.completion.artifactsRun.detail}</>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {/* done: a green plate with a tick, the signal of a finished goal */}
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ok text-on-ok" aria-hidden="true">
              <Check size={17} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1 basis-64 text-[15px] leading-snug text-ink">
              {g.delivery.cleanup?.done ? (
                <>The work is in your repository on <span className="mono font-semibold">{g.delivery.policy.baseBranch ?? g.baseBranch}</span>.</>
              ) : (
                <>
                  The work is on branch <span className="mono font-semibold">{g.branch}</span> in your repository.
                  {g.delivery.status === 'delivered' ? ' It has been delivered as configured.' : ' Nothing has left your machine.'}
                </>
              )}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <OpenMenu goalId={g.id} places={[...(d.paths.workspace ? [{ which: 'workspace' as const, label: 'The result', path: d.paths.workspace, hint: `branch ${g.branch}` }] : []), { which: 'repo' as const, label: 'Your repository', path: d.paths.repo }]} label="Open" working={['running', 'goal_review'].includes(g.state)} />
              {g.delivery.status !== 'delivered' && (
                <Button size="sm" variant="primary" onClick={onDeliver} title="Push / open a pull request / merge — opens the Delivery tab in Expert view">
                  Deliver…
                </Button>
              )}
            </span>
          </div>
          <MergeStatus goal={g} className="mt-3" />
        </Card>
      )}
      {review && <GoalReview review={review} />}
      <MarkdownPanel title="what you asked for" source={g.prompt} maxHeight={160} actions={<OpenFull value={{ title: g.title, text: g.prompt }} />} />
      {g.state !== 'awaiting_brief_approval' && <BriefStrip d={d} />}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
        <Badge state={g.state} /> · goal <span className="mono">{g.id}</span>
      </div>
    </div>
  );
}

/** a figure of the Cost card: its label in small capitals, the value large, its limit, and a thin bar against the limit */
function Figure({ label, value, limit, pct, note, children }: { label: string; value: ReactNode; limit: string; /** null: no limit, no bar */ pct: number | null; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={LABEL}>{label}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="mono text-2xl font-bold leading-none text-ink">{value}</b>
        <span className="mono text-sm text-ink-faint">of {limit}</span>
        {note}
      </div>
      {pct != null && (
        // ink, yellow past 70 %, red past 90 %
        <span className="mt-2.5 block h-1 max-w-xs overflow-hidden rounded-xs bg-line" aria-hidden="true">
          <i className={cn('block h-full rounded-xs', pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-you' : 'bg-ink')} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </span>
      )}
      {children}
    </div>
  );
}
