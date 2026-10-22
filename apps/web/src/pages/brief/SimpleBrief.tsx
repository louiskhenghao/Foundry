import { reportsDollars } from '@foundry/core/browser';
import type { Brief, Goal } from '@foundry/core/browser';
import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Button, Card, Input, cn } from '../../ui.tsx';
import { areaStyle } from './shared.ts';
import { NotesComposer } from './NotesComposer.tsx';
import { StyleCards } from './StyleCards.tsx';
import { ACCEPTED_TICK, AnsweredTick, type Hold, Holds, ReadOnlyTick, answerChip, blockingTag } from './marks.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

/**
 * The Brief as a non-technical reader needs it: what the system understood, what it will build, the questions
 * only they can answer, the assumptions they can veto, and the price. Everything else lives in the Expert view.
 */
export function SimpleBrief(p: {
  /** the page's head, the Expert view's own (state, title, facts, stages), its switch leading to Expert view */
  head: ReactNode;
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
  /** what holds the approval back (the button stays disabled while there is any) */
  blockers: Hold[];
  pendingDecisions: number;
  busy: boolean;
  dirty: boolean;
  err: string | null;
  onApprove: () => void;
  onSave: () => void;
  onCancel: () => void;
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
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-6">
      {p.head}
      <div className="space-y-4">
        <Card title={<span className="flex items-start gap-1.5"><SectionTitle section="understanding">What I understood</SectionTitle><HelpLink to="approving-the-brief" className="mt-0.5 shrink-0" /></span>}>
          <MarkdownPanel title="" source={brief.understanding} maxHeight={400} actions={<OpenFull value={{ title: 'What I understood', text: brief.understanding }} />} />
        </Card>

        {asked.length > 0 && (
          <Card title={<SectionTitle section="questions">{blockingUnanswered.length ? `Please answer (${blockingUnanswered.length})` : 'Questions'}</SectionTitle>}>
            <div className="space-y-5">
              {brief.questions.map((q, i) => (q.kind === 'note' ? null : q.kind === 'style' && brief.styleOptions.length ? <StyleCards key={q.id} goalId={g.id} brief={brief} question={q} editable={editable} update={update} tag="needed" /> : (
                <div key={q.id}>
                  {/* needed and unanswered waits for you, in yellow; once answered it is ticked green */}
                  <div className="text-sm font-semibold text-ink mb-2 flex items-start gap-2 flex-wrap">
                    <AnsweredTick answer={q.answer} />
                    {q.blocking && <span className={blockingTag(!!q.answer?.trim())}>needed</span>}
                    <span className="min-w-0 flex-1 basis-64">{q.text}</span>
                  </div>
                  {q.options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {q.options.map((opt, oi) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={!editable}
                          title={oi === 0 ? 'Recommended' : undefined}
                          className={cn(answerChip((q.answer ?? '') === opt), 'text-left')}
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
            {p.pendingDecisions > 0 && <p className="text-xs font-semibold text-you-ink mt-3">Your answers reach every worker. If they change what should be built, use Expert view → Revise with answers so the plan below follows them.</p>}
          </Card>
        )}

        {p.subjects}

        {(editable || brief.questions.some((q) => q.kind === 'note')) && (
          <Card title={<SectionTitle section="decisions">Anything to add?</SectionTitle>}>
            <p className="text-xs text-ink-faint mb-2">Something Foundry did not ask, or got wrong. Your notes reach every worker, like your answers.</p>
            <NotesComposer brief={brief} editable={editable} edit={p.edit} compact />
          </Card>
        )}

        {brief.assumptions.length > 0 && (
          <Card title={<SectionTitle section="assumptions">I will assume… (untick anything that is wrong)</SectionTitle>}>
            <div className="space-y-1.5">
              {brief.assumptions.map((a, i) => (
                <label key={a.id} className="flex items-start gap-2 text-sm text-ink">
                  <input type="checkbox" className={cn('mt-1', !editable && 'sr-only')} style={ACCEPTED_TICK} disabled={!editable} checked={a.accepted} onChange={(e) => update({ assumptions: brief.assumptions.map((x, j) => (j === i ? { ...x, accepted: e.target.checked, applied: false } : x)) })} />
                  {!editable && <ReadOnlyTick on={a.accepted} />}
                  <span className={cn(!a.accepted && 'line-through text-ink-faint')}>{a.text}</span>
                </label>
              ))}
            </div>
          </Card>
        )}

        <Card title={<SectionTitle section="plan">{p.planning ? 'What you will get' : `What you will get (${brief.tasks.length} piece${brief.tasks.length === 1 ? '' : 's'} of work)`}</SectionTitle>}>
          {p.planning && (
            <p className="text-sm text-work-ink mb-3 flex items-start gap-1.5">
              <Loader2 size={14} className="mt-[3px] animate-spin shrink-0" /> Foundry is splitting the goal into pieces of work; they appear here by themselves. You can read and change the rest meanwhile.
            </p>
          )}
          <div className="space-y-4">
            {byArea.map(({ area, tasks }) => (
              <div key={area?.key ?? '_'}>
                {area && (
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: areaStyle(brief, area.key).dot }} />
                    <span className="text-sm font-bold text-ink">{area.name}</span>
                    {area.description && <span className="text-xs text-ink-faint">— {area.description}</span>}
                    {/* while the planner works every part is still empty: nothing to warn about yet */}
                    {tasks.length === 0 && <span className={cn('text-xs', p.planning ? 'text-ink-faint' : 'font-semibold text-bad-ink')}>nothing planned for this part</span>}
                  </div>
                )}
                <ul className="text-sm text-ink-soft space-y-0.5 pl-4 list-disc marker:text-ink-faint">
                  {tasks.map((t) => (
                    <li key={t.key}>{t.title}</li>
                  ))}
                </ul>
              </div>
            ))}
            {unassigned.length > 0 && (
              <ul className="text-sm text-ink-soft space-y-0.5 pl-4 list-disc marker:text-ink-faint">
                {unassigned.map((t) => (
                  <li key={t.key}>{t.title}</li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-ink-faint mt-4">To change the plan itself (add, remove or reorder pieces, set acceptance checks), open Expert view.</p>
        </Card>

        <Card title={<SectionTitle section="budget">{!reportsDollars(g.provider) ? 'Time & limits' : 'Price & time'}</SectionTitle>}>
          {p.planning ? (
            <p className="text-sm text-work-ink">The estimate arrives with the plan.</p>
          ) : (
            <p className="text-[15px] text-ink">
              {reportsDollars(g.provider) && (
                <>
                  Estimated <b className="mono">${brief.costEstimateUsd}</b> and{' '}
                </>
              )}
              about <b className="mono">{brief.timeEstimateMin} min</b>.
            </p>
          )}
          {!p.planning && p.calibration && <p className="text-xs text-ink-soft mt-1">{p.calibration}</p>}
          {!reportsDollars(g.provider) && <p className="text-xs text-ink-soft mt-2">Dollar cost is unavailable. Time, attempts and concurrency still apply.</p>}
          {editable && <div className="flex flex-wrap gap-3 mt-4">
            {reportsDollars(g.provider) && <label className="text-xs font-semibold text-ink-soft">Max cost (USD)<Input type="number" min={0.5} step={0.5} className="mt-1 mono" value={p.budgetDraft.maxCostUsd ?? ''} placeholder="No limit" onChange={(e) => p.setBudgetEdit({ ...p.budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} /></label>}
            <label className="text-xs font-semibold text-ink-soft">Max minutes<Input type="number" min={5} step={5} className="mt-1 mono" value={p.budgetDraft.maxDurationMin ?? ''} placeholder="No limit" onChange={(e) => p.setBudgetEdit({ ...p.budgetDraft, maxDurationMin: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>}
        </Card>

        {p.err && <div className="rounded-md border border-bad/50 bg-panel px-3 py-2 text-sm text-bad-ink">{p.err}</div>}
        {editable ? (
          // the actions follow you down the page, on the page's own colour under a hairline; what holds them back beside
          // them (above them on a phone), each in its signal colour
          <div className="sticky bottom-0 py-3 bg-page border-t border-line flex flex-col gap-2 sm:flex-row sm:items-center">
            {p.blockers.length > 0 && (
              <div className="min-w-0 flex-1 text-xs">
                <Holds holds={p.blockers} />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 sm:ml-auto">
              <Button variant="danger" onClick={p.onCancel}>
                Cancel
              </Button>
              <Button disabled={!p.dirty || p.busy} onClick={p.onSave}>
                Save
              </Button>
              <Button variant="primary" disabled={p.busy || p.blockers.length > 0} onClick={p.onApprove} title={p.blockers.map((b) => b.text).join('; ')}>
                <Check size={14} /> Looks good — go
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-soft">
            This plan was <span className="font-semibold text-ok-ink">approved</span>; the work is under way.
          </div>
        )}
      </div>
    </div>
  );
}
