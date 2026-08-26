import type { CheckResult } from '@ai-engine/core/browser';
import { Link } from 'react-router-dom';
import type { GoalDetail } from '../../api.ts';
import { AttachmentInput } from '../../components/Attachments.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { WorkspaceCard } from './WorkspaceCard.tsx';
import { Badge, Card, cn } from '../../ui.tsx';
import { EscalationCard } from '../InboxPage.tsx';

const STAGES = ['clarifying', 'awaiting_brief_approval', 'running', 'goal_review', 'done'] as const;
const STAGE_LABEL: Record<string, string> = { clarifying: 'Clarify', awaiting_brief_approval: 'Brief', running: 'Run', goal_review: 'Review', done: 'Done' };

export function OverviewTab({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const open = d.escalations.filter((e) => e.state === 'open');
  const reached = new Set(d.events.filter((e) => e.type === 'goal.state_changed').map((e) => (e.payload as any).to as string));
  const terminalOk = g.state === 'done' || g.state === 'over_delivered';
  const stageIdx = (s: string) => STAGES.indexOf(s as any);
  const currentIdx = g.state === 'blocked' ? stageIdx(g.stateBeforeBlock ?? 'running') : terminalOk ? STAGES.length - 1 : stageIdx(g.state);
  const review = [...d.events].reverse().find((e) => e.type === 'review.goal.finished')?.payload as any;
  const latestResult = (checkId: string): CheckResult | undefined => [...d.checkResults].reverse().find((r) => r.checkId === checkId);
  const must = d.checks.filter((c) => c.tier === 'must');
  const stretch = d.checks.filter((c) => c.tier === 'stretch');
  const taskName = (id: string | null) => (id ? d.tasks.find((t) => t.id === id)?.title ?? id : 'goal');

  return (
    <div className="space-y-4">
      {/* timeline */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        {STAGES.map((s, i) => {
          const done = i < currentIdx || (i === currentIdx && terminalOk) || reached.has(s) && i < currentIdx;
          const active = i === currentIdx && !terminalOk;
          return (
            <div key={s} className="flex items-center gap-1.5 sm:gap-2 sm:flex-1 min-w-0">
              <div className={cn('flex items-center gap-2 rounded-md border px-2 sm:px-2.5 py-1.5 text-xs sm:flex-1 whitespace-nowrap', done ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300' : active ? 'border-blue-500/50 bg-blue-500/5 text-blue-300' : 'border-zinc-800 text-zinc-500')}>
                <span className={cn('h-2 w-2 rounded-full shrink-0', done ? 'bg-emerald-400' : active ? 'bg-blue-400 animate-pulse' : 'bg-zinc-700')} />
                {s === 'done' && g.state === 'over_delivered' ? 'Over-delivered' : STAGE_LABEL[s]}
              </div>
              {i < STAGES.length - 1 && <div className={cn('h-px w-2 sm:w-3', done ? 'bg-emerald-500/40' : 'bg-zinc-800')} />}
            </div>
          );
        })}
        {g.delivery.policy.mode !== 'local' && (
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className={cn('h-px w-2 sm:w-3', terminalOk ? 'bg-emerald-500/40' : 'bg-zinc-800')} />
            <div className={cn('flex items-center gap-2 rounded-md border px-2 sm:px-2.5 py-1.5 text-xs whitespace-nowrap', g.delivery.status === 'delivered' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300' : g.delivery.status === 'running' ? 'border-blue-500/50 bg-blue-500/5 text-blue-300' : g.delivery.status === 'failed' ? 'border-rose-500/40 bg-rose-500/5 text-rose-300' : 'border-zinc-800 text-zinc-500')} title={g.delivery.status === 'idle' ? `Delivery (${g.delivery.policy.mode}) starts automatically once the goal is done` : `Delivery ${g.delivery.status}`}>
              <span className={cn('h-2 w-2 rounded-full shrink-0', g.delivery.status === 'delivered' ? 'bg-emerald-400' : g.delivery.status === 'running' ? 'bg-blue-400 animate-pulse' : g.delivery.status === 'failed' ? 'bg-rose-400' : 'bg-zinc-700')} />
              Deliver · {g.delivery.policy.mode}
              {g.delivery.prs.length > 0 && (
                <span className="text-zinc-500">
                  · {g.delivery.prs.length} PR{g.delivery.prs.length === 1 ? '' : 's'}
                  {g.delivery.prs.some((p) => p.state === 'merged') ? ` · ${g.delivery.prs.filter((p) => p.state === 'merged').length} merged` : ''}
                </span>
              )}
            </div>
          </div>
        )}
        {(g.state === 'failed' || g.state === 'cancelled' || g.state === 'blocked') && <Badge state={g.state} className="ml-2" />}
      </div>

      {open.length > 0 && (
        <div className="space-y-2">
          {open.map((e) => (
            <EscalationCard key={e.id} e={e} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <MarkdownPanel title="goal" source={g.prompt} maxHeight={240} />
          <WorkspaceCard d={d} />
          {d.events.some((e) => e.type === 'goal.models_changed') && (
            <Card title="Model fallback">
              <div className="text-xs text-zinc-400 space-y-1">
                {d.events
                  .filter((e) => e.type === 'goal.models_changed')
                  .map((e, i) => {
                    const p = e.payload as any;
                    return (
                      <div key={i}>
                        <span className="mono text-zinc-200">{p.from}</span> was unavailable → {p.tier ? `${p.tier} sessions now use ` : 'used '}
                        <span className="mono text-zinc-200">{p.to}</span> <span className="text-zinc-600">({p.reason})</span>
                      </div>
                    );
                  })}
                <div className="text-[11px] text-zinc-500">
                  Current models: strong <span className="mono">{g.models.strong}</span> · worker <span className="mono">{g.models.worker}</span> · cheap <span className="mono">{g.models.cheap}</span>
                </div>
              </div>
            </Card>
          )}
          {g.autoskills && (
            <Card title="Project skills (autoskills)">
              <div className="text-xs text-zinc-400">
                {g.autoskills.status === 'installed' ? (
                  <>
                    Installed for this repository's stack, loaded in every worker session: <span className="mono text-zinc-200">{g.autoskills.skills.map((s) => `/${s}`).join(', ')}</span>
                  </>
                ) : (
                  <>
                    <span className={g.autoskills.status === 'failed' ? 'text-rose-300' : 'text-zinc-300'}>{g.autoskills.status}</span> — {g.autoskills.detail}
                  </>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">Written to the goal workspace's .claude/skills and git-excluded; they never reach a commit or PR.</p>
            </Card>
          )}
          {(g.completion.graphRefresh || g.completion.docs.length > 0) && (
            <Card title="Completion">
              <div className="text-xs text-zinc-400 space-y-1.5">
                {g.completion.docs.length > 0 && (
                  <div>
                    Docs: <span className="mono text-zinc-200">{g.completion.docs.join(', ')}</span>
                    {g.completion.docsRun ? (
                      <span className={g.completion.docsRun.status === 'failed' ? 'text-rose-300' : 'text-zinc-300'}>
                        {' '}
                        — {g.completion.docsRun.status}, {g.completion.docsRun.detail}
                      </span>
                    ) : (
                      <span className="text-zinc-600"> — generated after the goal review passes, committed to the goal branch</span>
                    )}
                  </div>
                )}
                {g.completion.graphRefresh && (
                  <div>
                    Graph refresh:{' '}
                    {g.completion.graphRun ? (
                      <span className="mono text-zinc-200">{g.completion.graphRun.tools.map((t) => `${t.name} ${t.status}`).join(', ')}</span>
                    ) : (
                      <span className="text-zinc-600">runs when the goal is delivered (graphify, and gitnexus when installed)</span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
          <Card title={`Attachments${g.attachments.length ? ` (${g.attachments.length})` : ''}`}>
            <AttachmentInput items={g.attachments} goalId={g.id} onChange={() => {}} />
            <p className="text-[11px] text-zinc-500 mt-2">Attachments are handed to every new session of this goal (Clarify, workers, goal review) as read-only references.</p>
          </Card>
          {d.brief ? (
            <Card
              title={
                <span>
                  Brief {d.brief.approved ? <Badge state="pass">approved</Badge> : <Badge state="pending" />}
                </span>
              }
              actions={
                <Link to={`/goals/${g.id}/brief`} className="text-xs underline text-zinc-400">
                  open
                </Link>
              }
            >
              <MarkdownPanel title="understanding" source={d.brief.brief.understanding} maxHeight={260} />
              <div className="text-xs text-zinc-400 mt-3 flex gap-x-4 gap-y-1 flex-wrap">
                <span>{d.brief.brief.tasks.length} tasks</span>
                <span>
                  {d.brief.brief.assumptions.filter((a) => a.accepted).length}/{d.brief.brief.assumptions.length} assumptions accepted
                </span>
                <span>{d.brief.brief.questions.filter((q) => q.answer).length}/{d.brief.brief.questions.length} questions answered</span>
                <span>
                  est. ${d.brief.brief.costEstimateUsd} / {d.brief.brief.timeEstimateMin} min
                </span>
              </div>
            </Card>
          ) : (
            <Card title="Brief">
              <div className="text-sm text-zinc-500">Not produced yet.</div>
            </Card>
          )}
          {review && (
            <Card title={`Goal review — ${review.passed ? (review.overDelivered ? 'over-delivered' : 'passed') : 'failed'}`}>
              {review.notes ? <MarkdownPanel title="reviewer notes" source={review.notes} maxHeight={240} /> : <div className="text-xs text-zinc-500">no notes</div>}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Acceptance">
            {[
              ['must', must],
              ['stretch', stretch],
            ].map(([tier, list]) => (
              <div key={tier as string} className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge state={tier as string} />
                  <span className="text-[11px] text-zinc-500">
                    {(list as typeof must).filter((c) => latestResult(c.id)?.status === 'pass').length}/{(list as typeof must).length} passing
                  </span>
                </div>
                {(list as typeof must).length === 0 && <div className="text-xs text-zinc-600">none</div>}
                {(list as typeof must).map((c) => {
                  const r = latestResult(c.id);
                  return (
                    <details key={c.id} className="text-xs py-0.5">
                      <summary className="flex items-center gap-2 cursor-pointer list-none">
                        {r ? <Badge state={r.status} /> : <span className="text-zinc-600 text-[10px] w-10 text-center">—</span>}
                        <span className="truncate flex-1" title={c.name}>
                          {c.name}
                        </span>
                        <span className="text-[10px] text-zinc-600 truncate max-w-[80px]">{taskName(c.taskId)}</span>
                      </summary>
                      {r && <pre className="mono text-[11px] text-zinc-400 bg-zinc-950 rounded p-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{r.summary}</pre>}
                    </details>
                  );
                })}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
