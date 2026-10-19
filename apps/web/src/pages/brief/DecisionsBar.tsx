import type { Brief } from '@foundry/core/browser';
import { decisionsOf, diffIsEmpty, markDecisionsApplied } from '@foundry/core/browser';
import { Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { api, type DraftProposal } from '../../api.ts';
import { Button, Card, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { DraftPanel } from './DraftPanel.tsx';
import { NotesComposer } from './NotesComposer.tsx';

/**
 * The human's Decisions (answers, notes, rejected assumptions) and whether the plan honours them yet.
 * "Revise with answers" asks the Clarifier for a revision; accepting any of it marks the Decisions applied.
 * A note written here is a Decision too: saved with the Brief, it reaches every session and a Re-run Clarify.
 */
export function DecisionsBar({ brief, goalId, editable, edit }: { brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decisions = decisionsOf(brief);
  if (!decisions.length && !editable) return null;
  const pending = decisions.filter((d) => !d.applied);
  const revise = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { proposal } = await api.draftBrief(goalId, { mode: 'revise', brief, notes: '' });
      setProposal(proposal);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const markApplied = () => edit((b) => markDecisionsApplied(b));
  const noChanges = proposal?.revision && diffIsEmpty(proposal.revision.diff);
  return (
    <Card
      title={`Decisions (${decisions.length})`}
      actions={
        editable && decisions.length > 0 && (
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
      <p className="text-xs text-zinc-500 mb-2">
        {decisions.length ? (
          <>
            Every worker, reviewer and pull request receives these verbatim. {pending.length > 0 ? <span className="text-amber-300">{pending.length} not yet applied to the plan — the tasks and checks below still reflect the Brief as it was before you decided.</span> : <span className="text-emerald-300">All applied to the plan.</span>}
          </>
        ) : (
          <>No decisions yet: answer a question, reject an assumption, or write a note below. Every worker, reviewer and pull request receives them verbatim.</>
        )}
      </p>
      <ul className="space-y-1 text-sm">
        {decisions.map((d) => (
          <li key={d.id} className={cn('flex gap-2 items-start', d.applied ? 'text-zinc-400' : 'text-zinc-200')}>
            <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', d.applied ? 'bg-emerald-400' : 'bg-amber-400')} title={d.applied ? 'applied to the plan' : 'not yet applied to the plan'} />
            {d.kind === 'answer' ? (
              <span>
                <span className="text-zinc-400">{d.text}</span> → <span className="font-medium">{d.answer}</span>
              </span>
            ) : d.kind === 'note' ? (
              <span className="flex-1 flex items-start gap-2">
                <span className="flex-1 whitespace-pre-wrap">
                  <span className="text-[11px] text-zinc-500 mr-1">note</span>
                  {d.text}
                </span>
                {editable && (
                  <button type="button" className="text-zinc-500 hover:text-rose-300 shrink-0 mt-0.5" title="Remove this note" onClick={() => edit((b) => ({ ...b, questions: b.questions.filter((q) => q.id !== d.id) }))}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ) : (
              <span>
                <span className="line-through text-zinc-500">{d.text}</span> <span className="text-[11px] text-zinc-500">(assumption rejected)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={cn(decisions.length > 0 && 'mt-3 border-t border-zinc-800 pt-3')}>
        <NotesComposer brief={brief} editable={editable} edit={edit} />
      </div>
      {err && <div className="text-xs text-rose-300 mt-2">{err}</div>}
      {busy && (
        <div className="mt-3">
          <p className="text-xs text-zinc-500 mb-1">The Clarifier is re-reading the Brief and the repository — its live output below. A revision usually takes a few minutes.</p>
          <LiveLog attemptId={`draft-${goalId}`} className="max-h-56" />
        </div>
      )}
      {proposal && (
        <div className="mt-3">
          {noChanges ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-zinc-300 flex items-center gap-2 flex-wrap">
              <span>The Clarifier found nothing to change: {proposal.revision!.changeSummary}</span>
              <Button size="sm" className="ml-auto" onClick={() => { markApplied(); setProposal(null); }}>
                <Check size={12} /> OK, mark applied
              </Button>
            </div>
          ) : (
            <DraftPanel
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
