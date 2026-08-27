import type { Brief } from '@ai-engine/core/browser';
import { decisionsOf, diffIsEmpty, markDecisionsApplied } from '@ai-engine/core/browser';
import { Check, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, type DraftProposal } from '../../api.ts';
import { Button, Card, Input, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { DraftPanel } from './DraftPanel.tsx';

/**
 * The human's Decisions (answers, rejected assumptions) and whether the plan honours them yet.
 * "Revise with answers" asks the Clarifier for a revision; accepting any of it marks the Decisions applied.
 */
export function DecisionsBar({ brief, goalId, editable, edit }: { brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decisions = decisionsOf(brief);
  if (!decisions.length) return null;
  const pending = decisions.filter((d) => !d.applied);
  const revise = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { proposal } = await api.draftBrief(goalId, { mode: 'revise', brief, notes });
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
        editable && (
          <span className="flex items-center gap-1.5">
            <Input className="text-xs py-1 w-48 hidden md:block" placeholder="notes for the AI (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
        Every worker, reviewer and pull request receives these verbatim. {pending.length > 0 ? <span className="text-amber-300">{pending.length} not yet applied to the plan — the tasks and checks below still reflect the Brief as it was before you decided.</span> : <span className="text-emerald-300">All applied to the plan.</span>}
      </p>
      <ul className="space-y-1 text-sm">
        {decisions.map((d) => (
          <li key={d.id} className={cn('flex gap-2 items-start', d.applied ? 'text-zinc-400' : 'text-zinc-200')}>
            <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', d.applied ? 'bg-emerald-400' : 'bg-amber-400')} title={d.applied ? 'applied to the plan' : 'not yet applied to the plan'} />
            {d.kind === 'answer' ? (
              <span>
                <span className="text-zinc-400">{d.text}</span> → <span className="font-medium">{d.answer}</span>
              </span>
            ) : (
              <span>
                <span className="line-through text-zinc-500">{d.text}</span> <span className="text-[11px] text-zinc-500">(assumption rejected)</span>
              </span>
            )}
          </li>
        ))}
      </ul>
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
