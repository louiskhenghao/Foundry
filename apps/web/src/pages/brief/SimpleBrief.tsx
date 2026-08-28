import type { Brief, Goal } from '@foundry/core/browser';
import { Check, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Badge, Button, Card, Input, cn, fmtLimitMin, fmtLimitUsd } from '../../ui.tsx';
import { areaStyle } from './shared.ts';
import { StyleCards } from './StyleCards.tsx';

/**
 * The Brief as a non-technical reader needs it: what the system understood, what it will build, the questions
 * only they can answer, the assumptions they can veto, and the price. Everything else lives in the Expert view.
 */
export function SimpleBrief(p: {
  brief: Brief;
  goal: Goal;
  editable: boolean;
  update: (patch: Partial<Brief>) => void;
  budgetDraft: { maxCostUsd: number | null; maxDurationMin: number | null };
  setBudgetEdit: (b: { maxCostUsd: number | null; maxDurationMin: number | null }) => void;
  proposed: { maxCostUsd: number | null; maxDurationMin: number | null };
  blockers: string[];
  pendingDecisions: number;
  busy: boolean;
  dirty: boolean;
  err: string | null;
  onApprove: () => void;
  onSave: () => void;
  onCancel: () => void;
  onExpert: () => void;
}) {
  const { brief, goal: g, editable, update } = p;
  const blockingUnanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
  const byArea = brief.areas.length ? brief.areas.map((a) => ({ area: a, tasks: brief.tasks.filter((t) => t.areaKey === a.key) })) : [{ area: null, tasks: brief.tasks }];
  const unassigned = brief.areas.length ? brief.tasks.filter((t) => !brief.areas.some((a) => a.key === t.areaKey)) : [];
  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <Link to={`/goals/${g.id}`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200" title="Back to the goal's run view">
        ← Goal
      </Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">{g.title}</h1>
        <Badge state={g.state} />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={p.onExpert} title="Show every control: Areas, task graph, acceptance checks, Draft and Revise">
          <Settings2 size={13} /> Expert view
        </Button>
      </div>

      <Card title="What I understood">
        <MarkdownPanel title="" source={brief.understanding} maxHeight={400} />
      </Card>

      {brief.questions.length > 0 && (
        <Card title={blockingUnanswered.length ? `Please answer (${blockingUnanswered.length})` : 'Questions'}>
          <div className="space-y-3">
            {brief.questions.map((q, i) => (q.kind === 'style' && brief.styleOptions.length ? <StyleCards key={q.id} goalId={g.id} brief={brief} question={q} editable={editable} update={update} /> : (
              <div key={q.id}>
                <div className="text-sm text-zinc-200 mb-1">
                  {q.blocking && <Badge state="must">needed</Badge>} {q.text}
                </div>
                {q.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {q.options.map((opt, oi) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={!editable}
                        title={oi === 0 ? 'Recommended' : undefined}
                        className={cn('text-[11px] rounded-full border px-2 py-0.5', (q.answer ?? '') === opt ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}
                        onClick={() => update({ questions: brief.questions.map((x, j) => (j === i ? { ...x, answer: opt, applied: false } : x)) })}
                      >
                        {opt}
                        {oi === 0 ? ' ★' : ''}
                      </button>
                    ))}
                  </div>
                )}
                <Input disabled={!editable} placeholder={q.options.length ? 'Pick an option or type your own answer' : 'Your answer'} value={q.answer ?? ''} onChange={(e) => update({ questions: brief.questions.map((x, j) => (j === i ? { ...x, answer: e.target.value, applied: false } : x)) })} />
              </div>
            )))}
          </div>
          {p.pendingDecisions > 0 && <p className="text-[11px] text-amber-300 mt-2">Your answers reach every worker. If they change what should be built, use Expert view → Revise with answers so the plan below follows them.</p>}
        </Card>
      )}

      {brief.assumptions.length > 0 && (
        <Card title="I will assume… (untick anything that is wrong)">
          <div className="space-y-1.5">
            {brief.assumptions.map((a, i) => (
              <label key={a.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" disabled={!editable} checked={a.accepted} onChange={(e) => update({ assumptions: brief.assumptions.map((x, j) => (j === i ? { ...x, accepted: e.target.checked, applied: false } : x)) })} />
                <span className={cn(!a.accepted && 'line-through text-zinc-500')}>{a.text}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <Card title={`What you will get (${brief.tasks.length} piece${brief.tasks.length === 1 ? '' : 's'} of work)`}>
        <div className="space-y-3">
          {byArea.map(({ area, tasks }) => (
            <div key={area?.key ?? '_'}>
              {area && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: areaStyle(brief, area.key).dot }} />
                  <span className="text-sm text-zinc-100 font-medium">{area.name}</span>
                  {area.description && <span className="text-xs text-zinc-500">— {area.description}</span>}
                  {tasks.length === 0 && <span className="text-xs text-rose-300">nothing planned for this part</span>}
                </div>
              )}
              <ul className="text-sm text-zinc-300 space-y-0.5 pl-4 list-disc">
                {tasks.map((t) => (
                  <li key={t.key}>{t.title}</li>
                ))}
              </ul>
            </div>
          ))}
          {unassigned.length > 0 && (
            <ul className="text-sm text-zinc-300 space-y-0.5 pl-4 list-disc">
              {unassigned.map((t) => (
                <li key={t.key}>{t.title}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mt-3">To change the plan itself (add, remove or reorder pieces, set acceptance checks), open Expert view.</p>
      </Card>

      <Card title="Price">
        <div className="text-sm text-zinc-300">
          Estimated <span className="mono text-zinc-100">${brief.costEstimateUsd}</span> and about <span className="mono text-zinc-100">{brief.timeEstimateMin} min</span>.
          {editable && (
            <>
              {' '}
              The engine will stop and ask you at{' '}
              <Input type="number" min={0.5} step={0.5} className="w-24 inline-block mx-1" value={p.budgetDraft.maxCostUsd ?? ''} placeholder="∞" onChange={(e) => p.setBudgetEdit({ ...p.budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} />
              $ (blank = no limit; suggested {fmtLimitUsd(p.proposed.maxCostUsd)} / {fmtLimitMin(p.proposed.maxDurationMin)}).
            </>
          )}
        </div>
      </Card>

      {p.err && <div className="text-sm text-rose-400">{p.err}</div>}
      {editable ? (
        <div className="flex items-center justify-end gap-2 flex-wrap sticky bottom-0 py-3 bg-zinc-950/90 backdrop-blur">
          {p.blockers.length > 0 && <span className="text-[11px] text-zinc-500 mr-auto">{p.blockers.join(' · ')}</span>}
          <Button variant="danger" onClick={p.onCancel}>
            Cancel
          </Button>
          <Button disabled={!p.dirty || p.busy} onClick={p.onSave}>
            Save
          </Button>
          <Button variant="primary" disabled={p.busy || p.blockers.length > 0} onClick={p.onApprove} title={p.blockers.join('; ')}>
            <Check size={14} /> Looks good — go
          </Button>
        </div>
      ) : (
        <div className="text-sm text-zinc-400">This plan was approved; the work is under way.</div>
      )}
    </div>
  );
}
