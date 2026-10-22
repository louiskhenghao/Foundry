import type { Brief, Goal, InterviewQuestion } from '@foundry/core/browser';
import { decisionsOf, diffIsEmpty, markDecisionsApplied } from '@foundry/core/browser';
import { Check, MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type DraftProposal } from '../../api.ts';
import { Button, Card, NEEDS_YOU_CARD, YouStrip, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { RoundForm, type RoundSubmitKind } from '../goal/RoundForm.tsx';
import { DraftPanel } from './DraftPanel.tsx';
import { NotesComposer } from './NotesComposer.tsx';
import { SectionTitle } from './SectionTitle.tsx';

type Round = { round: number; questions: InterviewQuestion[] };

/**
 * The human's Decisions (answers, notes, rejected assumptions) and whether the plan honours them yet.
 * "Revise with answers" asks the Clarifier for a revision; accepting any of it marks the Decisions applied.
 * A Revise may ask a round or two first: the round waits here (and on the goal, across reloads) until answered,
 * let go, or the Brief is approved. A note written here is a Decision too: saved with the Brief, it reaches every
 * session and a Re-run Clarify.
 */
export function DecisionsBar({ brief, goal, goalId, editable, revisable = editable, edit, beforeRevise }: { brief: Brief; goal: Goal; goalId: string; editable: boolean; /** Revise applies (false while the planner still fills the Brief skeleton: notes can be added, nothing revised yet) */ revisable?: boolean; edit: (fn: (b: Brief) => Brief) => void; /** saves the page's edits first, so a note typed here survives a reload while a round waits */ beforeRevise?: () => Promise<void> }) {
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  /** which proposal is on screen: a new one gets a fresh panel, never the previous one's ticks */
  const [proposalNo, setProposalNo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<RoundSubmitKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** the round a Revise asked and still waits on: from the goal (survives a reload) or the latest reply */
  const persisted = goal.revise?.status === 'awaiting_answers' ? (goal.revise.rounds.at(-1) ?? null) : null;
  const [round, setRound] = useState<Round | null>(persisted);
  useEffect(() => {
    setRound(persisted ? { round: persisted.round, questions: persisted.questions } : null);
  }, [persisted?.round, goal.revise?.status, goalId]);
  const decisions = decisionsOf(brief);
  if (!decisions.length && !editable) return null;
  const pending = decisions.filter((d) => !d.applied);
  const took = (p: DraftProposal) => {
    if (p.round) {
      setRound(p.round);
      setProposal(null);
      return;
    }
    setRound(null);
    setProposal(p);
    setProposalNo((n) => n + 1);
    // what the human answered in the rounds is theirs, not a proposal: it is recorded as Decisions at once
    const decided = p.revision?.revised.questions.filter((q) => q.applied && q.answer?.trim()) ?? [];
    if (decided.length) edit((b) => ({ ...b, questions: [...b.questions, ...decided.filter((q) => !b.questions.some((x) => x.id === q.id || (x.text === q.text && x.answer === q.answer)))] }));
  };
  const revise = async () => {
    setBusy(true);
    setErr(null);
    try {
      await beforeRevise?.();
      const { proposal } = await api.draftBrief(goalId, { mode: 'revise', brief, notes: '' });
      took(proposal);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const answer = async (kind: RoundSubmitKind, answers: Record<string, string>, finish: boolean, note: string | null) => {
    setAnswering(kind);
    setBusy(true);
    setErr(null);
    try {
      const { proposal } = await api.reviseAnswer(goalId, { brief, answers, finish, note });
      took(proposal);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setAnswering(null);
      setBusy(false);
    }
  };
  const letGo = async () => {
    setErr(null);
    try {
      await api.reviseCancel(goalId);
      setRound(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const markApplied = () => edit((b) => markDecisionsApplied(b));
  const noChanges = proposal?.revision && diffIsEmpty(proposal.revision.diff);
  return (
    <Card
      title={<SectionTitle section="decisions">{`Decisions (${decisions.length})`}</SectionTitle>}
      actions={
        editable && revisable && decisions.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Button size="sm" className="whitespace-nowrap" variant={pending.length ? 'primary' : 'default'} disabled={busy} onClick={revise} title="The Clarifier re-reads the Brief and the repository and proposes the changes your decisions imply; you accept them item by item (≤ $3)">
              <Sparkles size={12} /> {busy ? 'Revising…' : 'Revise with answers'}
            </Button>
            {pending.length > 0 && (
              <Button size="sm" className="whitespace-nowrap" variant="ghost" onClick={markApplied} title="The plan already reflects these decisions; stop flagging them">
                <Check size={12} /> No changes needed
              </Button>
            )}
          </span>
        )
      }
    >
      <p className="text-xs text-ink-faint mb-3">
        {decisions.length ? (
          <>
            Every worker, reviewer and pull request receives these verbatim. {pending.length > 0 ? <span className="font-semibold text-you-ink">{pending.length} not yet applied to the plan — the tasks and checks below still reflect the Brief as it was before you decided.</span> : <span className="font-semibold text-ok-ink">All applied to the plan.</span>}
          </>
        ) : (
          <>No decisions yet: answer a question, reject an assumption, or write a note below. Every worker, reviewer and pull request receives them verbatim.</>
        )}
      </p>
      {/* a Decision applied to the plan is marked green; one the plan does not follow yet waits for you, in yellow */}
      <ul className="space-y-1.5 text-sm">
        {decisions.map((d) => (
          <li key={d.id} className={cn('flex gap-2 items-start', d.applied ? 'text-ink-soft' : 'text-ink')}>
            <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', d.applied ? 'bg-ok' : 'bg-you ring-1 ring-inset ring-on-you/40')} title={d.applied ? 'applied to the plan' : 'not yet applied to the plan'} />
            {d.kind === 'answer' ? (
              <span>
                <span className="text-ink-soft">{d.text}</span> → <span className="font-semibold">{d.answer}</span>
              </span>
            ) : d.kind === 'note' ? (
              <span className="flex-1 flex items-start gap-2">
                <span className="flex-1 whitespace-pre-wrap">
                  <span className="mr-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">note</span>
                  {d.text}
                </span>
                {editable && (
                  <button type="button" className="text-ink-faint hover:text-bad-ink shrink-0 mt-0.5" title="Remove this note" onClick={() => edit((b) => ({ ...b, questions: b.questions.filter((q) => q.id !== d.id) }))}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ) : (
              <span>
                <span className="line-through text-ink-faint">{d.text}</span> <span className="text-xs text-ink-faint">(assumption rejected)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={cn(decisions.length > 0 && 'mt-3 border-t border-line pt-3')}>
        <NotesComposer brief={brief} editable={editable} edit={edit} />
      </div>
      {err && <div className="text-xs text-bad-ink mt-2">{err}</div>}
      {round && !busy && (
        // a round of questions waits for you, as the interview's and the Inbox's do: the yellow strip, the form on the panel under it
        <section className={cn(NEEDS_YOU_CARD, 'mt-3')}>
          <YouStrip icon={MessageCircleQuestion} title={`Before it revises, the Clarifier asks (round ${round.round} of 2)`} since={goal.revise?.status === 'awaiting_answers' ? (goal.revise.rounds.find((r) => r.round === round.round)?.askedAt ?? null) : null} />
          {/* spaced as the interview's round: the form is a run of blocks */}
          <div className="p-4 sm:p-5 space-y-4 text-xs text-ink-soft">
            <RoundForm
              key={`${goalId}-revise-${round.round}`}
              round={round.round}
              questions={round.questions}
              rounds={goal.revise?.rounds ?? []}
              busy={answering}
              intro={<p className="max-w-[90ch] text-[13px] leading-relaxed text-ink-soft">Your decisions left these open. Answer, or press Enough and it proposes with its recommendations. You can still approve the Brief as it is meanwhile; that lets this revision go.</p>}
              finishLabel="Enough — propose now"
              finishTitle="Stop asking: the Clarifier proposes with its recommended answers for what is still open"
              onSubmit={answer}
              onCancel={letGo}
            />
          </div>
        </section>
      )}
      {busy && (
        <div className="mt-3">
          <p className="text-xs text-ink-faint mb-1">The Clarifier is re-reading the Brief and the repository — its live output below. A revision usually takes a few minutes.</p>
          <LiveLog attemptId={`draft-${goalId}`} className="max-h-56" />
        </div>
      )}
      {proposal && (
        <div className="mt-3">
          {noChanges ? (
            <div className="rounded-md border border-ok/30 bg-ok/5 p-3 text-xs text-ink-soft flex items-center gap-2 flex-wrap">
              <span>The Clarifier found nothing to change: {proposal.revision!.changeSummary}</span>
              <Button size="sm" className="ml-auto" onClick={() => { markApplied(); setProposal(null); }}>
                <Check size={12} /> OK, mark applied
              </Button>
            </div>
          ) : (
            <DraftPanel
              key={proposalNo}
              proposal={proposal}
              onApply={(fn) => edit((b) => markDecisionsApplied(fn(b)))}
              onClose={() => setProposal(null)}
            />
          )}
        </div>
      )}
    </Card>
  );
}
