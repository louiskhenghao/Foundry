import { reportsDollars } from '@foundry/core/browser';
import type { Brief, Goal } from '@foundry/core/browser';
import { Check, Loader2, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Badge, Button, Card, Input, cn, fmtLimitMin, fmtLimitUsd } from '../../ui.tsx';
import { areaStyle } from './shared.ts';
import { NotesComposer } from './NotesComposer.tsx';
import { StyleCards } from './StyleCards.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

/**
 * The Brief as a non-technical reader needs it: what the system understood, what it will build, the questions
 * only they can answer, the assumptions they can veto, and the price. Everything else lives in the Expert view.
 */
export function SimpleBrief(p: {
  brief: Brief;
  goal: Goal;
  editable: boolean;
  /** the planner is still splitting the goal into pieces of work: the Brief skeleton shows, approval waits */
  planning?: boolean;
  update: (patch: Partial<Brief>) => void;
  budgetDraft: { maxCostUsd: number | null; maxDurationMin: number | null };
  setBudgetEdit: (b: { maxCostUsd: number | null; maxDurationMin: number | null }) => void;
  proposed: { maxCostUsd: number | null; maxDurationMin: number | null };
  /** how far earlier goals ran from their estimate, in a sentence (ADR-0056); null when too few finished yet */
  calibration?: string | null;
  blockers: string[];
  pendingDecisions: number;
  busy: boolean;
  dirty: boolean;
  err: string | null;
  onApprove: () => void;
  onSave: () => void;
  onCancel: () => void;
  onExpert: () => void;
  /** functional edit, for the notes (a note is a Decision kept among the Brief's questions) */
  edit: (fn: (b: Brief) => Brief) => void;
  /** the Subjects card (what the result must look like), or null when the goal has no look */
  subjects?: ReactNode;
}) {
  const { brief, goal: g, editable, update } = p;
  const asked = brief.questions.filter((q) => q.kind !== 'note');
  const blockingUnanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
  const byArea = brief.areas.length ? brief.areas.map((a) => ({ area: a, tasks: brief.tasks.filter((t) => t.areaKey === a.key) })) : [{ area: null, tasks: brief.tasks }];
  const unassigned = brief.areas.length ? brief.tasks.filter((t) => !brief.areas.some((a) => a.key === t.areaKey)) : [];
  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
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

      <Card title={<><SectionTitle section="understanding">What I understood</SectionTitle><HelpLink to="approving-the-brief" className="ml-1.5" /></>}>
        <MarkdownPanel title="" source={brief.understanding} maxHeight={400} actions={<OpenFull value={{ title: 'What I understood', text: brief.understanding }} />} />
      </Card>

      {asked.length > 0 && (
        <Card title={<SectionTitle section="questions">{blockingUnanswered.length ? `Please answer (${blockingUnanswered.length})` : 'Questions'}</SectionTitle>}>
          <div className="space-y-3">
            {brief.questions.map((q, i) => (q.kind === 'note' ? null : q.kind === 'style' && brief.styleOptions.length ? <StyleCards key={q.id} goalId={g.id} brief={brief} question={q} editable={editable} update={update} /> : (
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
                        className={cn('text-[11px] text-left rounded-xl border px-2 py-0.5', (q.answer ?? '') === opt ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}
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

      {p.subjects}

      {(editable || brief.questions.some((q) => q.kind === 'note')) && (
        <Card title={<SectionTitle section="decisions">Anything to add?</SectionTitle>}>
          <p className="text-xs text-zinc-500 mb-2">Something Foundry did not ask, or got wrong. Your notes reach every worker, like your answers.</p>
          <NotesComposer brief={brief} editable={editable} edit={p.edit} compact />
        </Card>
      )}

      {brief.assumptions.length > 0 && (
        <Card title={<SectionTitle section="assumptions">I will assume… (untick anything that is wrong)</SectionTitle>}>
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

      <Card title={<SectionTitle section="plan">{p.planning ? 'What you will get' : `What you will get (${brief.tasks.length} piece${brief.tasks.length === 1 ? '' : 's'} of work)`}</SectionTitle>}>
        {p.planning && (
          <p className="text-sm text-sky-300 mb-3 inline-flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" /> Foundry is splitting the goal into pieces of work; they appear here by themselves. You can read and change the rest meanwhile.
          </p>
        )}
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

      <Card title={<SectionTitle section="budget">{!reportsDollars(g.provider) ? 'Time & limits' : 'Price & time'}</SectionTitle>}>
        {p.planning ? <p className="text-sm text-sky-300">The estimate arrives with the plan.</p> : <p className="text-sm text-zinc-300">{reportsDollars(g.provider) && <>Estimated ${brief.costEstimateUsd} and </>}about {brief.timeEstimateMin} min.</p>}
        {!p.planning && p.calibration && <p className="text-xs text-zinc-400 mt-1">{p.calibration}</p>}
        {!reportsDollars(g.provider) && <p className="text-xs text-zinc-400 mt-2">Dollar cost is unavailable. Time, attempts and concurrency still apply.</p>}
        {editable && <div className="flex flex-wrap gap-3 mt-3">
          {reportsDollars(g.provider) && <label className="text-xs text-zinc-400">Max cost (USD)<Input type="number" min={0.5} step={0.5} value={p.budgetDraft.maxCostUsd ?? ''} placeholder="No limit" onChange={(e) => p.setBudgetEdit({ ...p.budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} /></label>}
          <label className="text-xs text-zinc-400">Max minutes<Input type="number" min={5} step={5} value={p.budgetDraft.maxDurationMin ?? ''} placeholder="No limit" onChange={(e) => p.setBudgetEdit({ ...p.budgetDraft, maxDurationMin: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        </div>}
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
