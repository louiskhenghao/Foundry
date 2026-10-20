import type { Brief } from '@foundry/core/browser';
import { diffIsEmpty } from '@foundry/core/browser';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type DraftProposal, type SecondOpinionView } from '../../api.ts';
import { Button, Card, ago } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { DraftPanel } from './DraftPanel.tsx';

/**
 * A second opinion on the Brief (ADR-0051): a reviewer that did not write it reads it against the repository and
 * proposes what to change, in the same checklist a Revise uses. On demand here; by itself when Settings say so.
 */
export function SecondOpinionBar({ goalId, stored, running, editable, edit, beforeRun }: { goalId: string; /** the last one, kept by the engine */ stored: SecondOpinionView | null; running: boolean; editable: boolean; edit: (fn: (b: Brief) => Brief) => void; /** saves the page's edits first, so the reviewer reads what the person sees */ beforeRun?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<DraftProposal | null>(stored?.proposal ?? null);
  const [shownAt, setShownAt] = useState<string | null>(stored?.at ?? null);
  const [err, setErr] = useState<string | null>(null);
  // one that finished by itself (or in another tab) arrives through the goal detail
  useEffect(() => {
    if (stored && stored.at !== shownAt) {
      setProposal(stored.proposal);
      setShownAt(stored.at);
    }
  }, [stored?.at]);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await beforeRun?.();
      const { proposal: p } = await api.secondOpinion(goalId);
      setProposal(p);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const live = busy || running;
  const noChanges = !!proposal?.revision && diffIsEmpty(proposal.revision.diff);
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          <Eye size={14} className="text-sky-300" /> Second opinion
        </span>
      }
      actions={
        editable ? (
          <Button size="sm" disabled={live} onClick={() => void run()} title="A reviewer that did not write the Brief reads it against the repository and proposes what to change (goal reviewer's model, read-only)">
            {live ? 'Reading…' : proposal ? 'Ask again' : 'Second opinion'}
          </Button>
        ) : undefined
      }
    >
      <p className="text-xs text-zinc-500">A reviewer that did not write this Brief reads it against the repository and proposes what to change. You apply what you take; nothing changes by itself.</p>
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
      {live && (
        <div className="mt-3">
          <p className="text-xs text-zinc-500 mb-1">The reviewer is reading the Brief and the repository — its live output below. A second opinion usually takes a few minutes.</p>
          <LiveLog attemptId={`draft-${goalId}`} className="max-h-56" />
        </div>
      )}
      {proposal && !live && (
        <div className="mt-3">
          {stored && stored.at === shownAt && (
            <p className="text-[11px] text-zinc-500 mb-2">
              {stored.auto ? 'Written by itself' : 'Asked for'} {ago(stored.at)}
              {stored.costAvailable === false ? '' : ` · $${stored.costUsd.toFixed(2)}`}
              {stored.stale ? ' · the Brief changed since: these rows were made against the earlier one' : ''}
            </p>
          )}
          {noChanges ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-zinc-300">The reviewer found nothing to change: {proposal.revision!.changeSummary}</div>
          ) : editable ? (
            <DraftPanel key={shownAt ?? 'fresh'} proposal={proposal} onApply={(fn) => edit(fn)} onClose={() => setProposal(null)} />
          ) : (
            <p className="text-xs text-zinc-400">{proposal.revision?.changeSummary ?? proposal.rationale}</p>
          )}
        </div>
      )}
    </Card>
  );
}
