import { Check, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GoalDetail } from '../../api.ts';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { Badge, Button, Card, cn, fmtLimitUsd, fmtUsd } from '../../ui.tsx';
import { EscalationCard } from '../InboxPage.tsx';

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

/** Progress for people who do not want the machinery: what is happening, how far, what it costs, what needs them. */
export function SimpleOverview({ d, onExpert }: { d: GoalDetail; onExpert: () => void }) {
  const g = d.goal;
  const total = d.tasks.length;
  const done = d.tasks.filter((t) => t.state === 'done' || t.state === 'skipped').length;
  const running = d.tasks.filter((t) => t.state === 'running' || t.state === 'observing' || t.state === 'merging');
  const open = d.escalations.filter((e) => e.state === 'open');
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const pct = total ? Math.round((done / total) * 100) : g.state === 'clarifying' ? 5 : 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-zinc-300">{STATE_TEXT[g.state] ?? g.state}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onExpert} title="Tasks, logs, acceptance checks, diff, delivery controls">
          <Settings2 size={13} /> Expert view
        </Button>
      </div>

      {open.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-orange-300 font-medium">Needs you</div>
          {open.map((e) => (
            <EscalationCard key={e.id} e={{ ...e, taskTitle: d.tasks.find((t) => t.id === e.taskId)?.title ?? null }} embedded />
          ))}
        </div>
      )}

      {g.state === 'awaiting_brief_approval' && (
        <Card>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-200">Read the plan and say go.</span>
            <Link to={`/goals/${g.id}/brief`} className="ml-auto">
              <Button size="sm" variant="primary">Read the plan →</Button>
            </Link>
          </div>
        </Card>
      )}

      {total > 0 && (
        <Card title="Progress">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className={cn('h-full rounded-full', finished ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-zinc-300 whitespace-nowrap">
              {done}/{total} pieces
            </span>
          </div>
          {running.length > 0 && (
            <ul className="mt-3 text-sm text-zinc-300 space-y-1">
              {running.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  <span>{t.title}</span>
                  <span className="text-[11px] text-zinc-500">{t.state === 'merging' ? 'combining with the rest' : t.state === 'observing' ? 'checking' : 'in progress'}</span>
                </li>
              ))}
            </ul>
          )}
          {d.tasks.some((t) => t.state === 'blocked') && <div className="mt-2 text-xs text-orange-300">{d.tasks.filter((t) => t.state === 'blocked').length} piece(s) waiting for you — see above.</div>}
        </Card>
      )}

      <Card title="Cost">
        <div className="text-sm text-zinc-300">
          Spent <span className="mono text-zinc-100">{fmtUsd(g.costUsd)}</span> of {fmtLimitUsd(g.budgets.maxCostUsd)} · running for {d.budget.elapsedMin.toFixed(0)} min.
        </div>
      </Card>

      {finished && (
        <Card title="Result">
          {g.completion.artifactsRun && (
            <div className={`text-sm mb-2 ${g.completion.artifactsRun.status === 'ok' ? 'text-emerald-300' : 'text-zinc-300'}`}>
              {g.completion.artifactsRun.status === 'ok' ? (
                <>
                  🎉 {g.completion.artifactsRun.files.length} file(s) are in <span className="mono">{g.completion.artifactsRun.dest}</span> — open the folder and have a look.
                </>
              ) : (
                <>{g.completion.artifactsRun.detail}</>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap text-sm text-zinc-300">
            <Check size={14} className="text-emerald-300" />
            <span>
              The work is on branch <span className="mono text-zinc-100">{g.branch}</span> in your repository.
              {g.delivery.status === 'delivered' ? ' It has been delivered as configured.' : ' Nothing has left your machine.'}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <OpenMenu goalId={g.id} places={[...(d.paths.workspace ? [{ which: 'workspace' as const, label: 'The result', path: d.paths.workspace, hint: `branch ${g.branch}` }] : []), { which: 'repo' as const, label: 'Your repository', path: d.paths.repo }]} label="Open" />
              {g.delivery.status !== 'delivered' && (
                <Button size="sm" variant="primary" onClick={onExpert} title="Push / open a pull request / merge — in Expert view, Delivery tab">
                  Deliver…
                </Button>
              )}
            </span>
          </div>
        </Card>
      )}
      <div className="text-[11px] text-zinc-600">
        <Badge state={g.state} /> · goal {g.id}
      </div>
    </div>
  );
}
