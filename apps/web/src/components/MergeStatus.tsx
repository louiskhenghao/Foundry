import type { Goal } from '@foundry/core/browser';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { Button, cn } from '../ui.tsx';

/**
 * Where a delivered goal's work is, in three lines (ADR-0015): merged on GitHub, in the user's local base branch,
 * and whether the goal's folders were tidied. Each unfinished line says why and offers the one button that helps.
 */
export function MergeStatus({ goal, className }: { goal: Goal; className?: string }) {
  const d = goal.delivery;
  const base = d.policy.baseBranch ?? goal.baseBranch;
  const [busy, setBusy] = useState<'pull' | 'force' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (d.status !== 'delivered' || !d.prs.length) return null;
  const merged = d.outcome === 'merged';
  const closed = d.prs.filter((p) => p.state === 'closed');
  const act = async (which: 'pull' | 'force') => {
    setBusy(which);
    setErr(null);
    try {
      await api.afterMerge(goal.id, which === 'pull' ? { pull: true } : { force: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    // a box inside the card it sits in (the Delivery tab's, the Simple view's Result)
    <div className={cn('rounded-md border border-line bg-sunken p-3 space-y-2 text-xs', className)}>
      {merged ? (
        <Line ok label={`Merged into ${base} on GitHub`} />
      ) : closed.length ? (
        <Line bad label={`Pull request${closed.length === 1 ? '' : 's'} ${closed.map((p) => `#${p.number}`).join(', ')} closed without merging`} detail="Nothing on your machine was changed or removed." />
      ) : (
        <Line label="Waiting for the pull request to merge" detail="Foundry checks GitHub every few minutes, and whenever this page opens." />
      )}
      {merged && (
        <Line
          ok={d.local?.upToDate === true}
          bad={d.local?.upToDate === false}
          label={`Your local ${base} is up to date`}
          detail={d.local?.detail ?? 'not checked yet'}
          action={
            d.local?.upToDate === false && (
              <Button size="sm" disabled={busy !== null} onClick={() => act('pull')} title={`Fast-forward your local ${base} to the merged result (only when that is safe)`}>
                {busy === 'pull' ? 'Pulling…' : 'Pull into my checkout'}
              </Button>
            )
          }
        />
      )}
      {merged && (
        <Line
          ok={d.cleanup?.done === true}
          bad={d.cleanup?.done === false}
          label="Workspace cleaned up"
          detail={d.cleanup?.detail ?? 'not yet'}
          action={
            d.cleanup?.done === false && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act('force')} title="Remove the progress folder, worktrees and local goal branches even though something above says to keep them">
                {busy === 'force' ? 'Cleaning…' : 'Clean up anyway'}
              </Button>
            )
          }
        />
      )}
      {err && <div className="text-bad-ink">{err}</div>}
    </div>
  );
}

/** one line: done in green; not done yet in yellow, its button being yours to press; still waiting, hollow and quiet */
function Line({ ok, bad, label, detail, action }: { ok?: boolean; bad?: boolean; label: string; detail?: string; action?: ReactNode }) {
  const Icon = ok ? CheckCircle2 : bad ? XCircle : CircleDashed;
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className={cn('mt-0.5 shrink-0', ok ? 'text-ok-ink' : bad ? 'text-you-ink' : 'text-ink-faint')} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">{label}</div>
        {detail && <div className="text-[11px] text-ink-faint break-words">{detail}</div>}
      </div>
      {action}
    </div>
  );
}
